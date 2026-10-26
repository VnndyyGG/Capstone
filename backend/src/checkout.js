const express = require('express');
const v = require('./validation');
const { priceCart, couponProblem, MIN_TOTAL } = require('./cart');
const { newBuyOrder } = require('./webpay');

const ORDER_TTL_MS = 30 * 60 * 1000;   // una orden "iniciada" más antigua que esto se considera abandonada
const RECONCILE_AFTER_MS = 20 * 1000;  // una orden "procesando" se reconsulta a Webpay pasado este tiempo
const clp = n => '$' + Number(n).toLocaleString('es-CL');

function createCheckout(ctx) {
  const { run, insert, one, all, atomic, audit, notify, roles, changeState, webpay, now } = ctx;
  const cutoff = () => new Date(Date.now() - ORDER_TTL_MS).toISOString();
  const expireStale = () => run("UPDATE orders SET status='expirada', updated_at=? WHERE status='iniciada' AND created_at < ?", now(), cutoff());
  const front = path => ctx.frontendUrl + path;

  function caseIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) v.fail(400, 'VALIDATION_ERROR', 'caseIds: entre 1 y 20 trámites.');
    const ids = value.map(x => v.integer(x, 'caseIds'));
    if (new Set(ids).size !== ids.length) v.fail(400, 'VALIDATION_ERROR', 'caseIds: trámites repetidos.');
    return ids.sort((a, b) => a - b);
  }

  /** Lee del servidor todo lo que importa (trámites, precios, cupón). Nada del cliente se usa como monto. */
  async function loadCart(user, body, lock = false) {
    const ids = caseIds(body.caseIds), suffix = lock ? ' FOR UPDATE' : '';
    const cases = await all(`SELECT * FROM cases WHERE id = ANY(?) AND client_id=? ORDER BY id${suffix}`, ids, user.id);
    if (cases.length !== ids.length) v.fail(404, 'NOT_FOUND', 'Trámite no encontrado.');
    const withDoc = new Set((await all('SELECT DISTINCT case_id FROM documents WHERE case_id = ANY(?)', ids)).map(r => r.case_id));
    for (const c of cases) {
      if (c.status !== 'pendiente_pago') v.fail(409, 'CART_INVALID', `El trámite ${c.folio} ya no está pendiente de pago.`);
      if (!withDoc.has(c.id)) v.fail(409, 'DOCUMENT_REQUIRED', `El trámite ${c.folio} no tiene documento guardado.`);
    }
    let coupon = null;
    if (body.coupon !== undefined && body.coupon !== null && String(body.coupon).trim() !== '') {
      const code = v.text(body.coupon, 'coupon', 40).toUpperCase();
      coupon = await one(`SELECT * FROM coupons WHERE code=?${suffix}`, code) || null;
      const uses = coupon ? (await one("SELECT COUNT(*) AS n FROM orders WHERE coupon_id=? AND status IN ('iniciada','procesando','pagada') AND NOT (status='iniciada' AND client_id=?)", coupon.id, user.id)).n : 0;
      const usesByClient = coupon ? (await one("SELECT COUNT(*) AS n FROM orders WHERE coupon_id=? AND client_id=? AND status IN ('procesando','pagada')", coupon.id, user.id)).n : 0;
      const problem = couponProblem(coupon, { now: now(), uses, usesByClient });
      if (problem) v.fail(409, 'COUPON_INVALID', problem);
    }
    const priced = priceCart(cases.map(c => ({ case_id: c.id, amount: c.amount })), coupon);
    if (coupon && priced.discount === 0) v.fail(409, 'COUPON_NOT_APPLICABLE', `El cupón no aplica: el total mínimo a pagar es ${clp(MIN_TOTAL)}.`);
    return { ids, cases, coupon, priced };
  }

  const quoteOf = ({ cases, coupon, priced }) => ({
    subtotal: priced.subtotal, discount: priced.discount, total: priced.total,
    coupon: coupon ? { code: coupon.code, amount: coupon.amount } : null,
    items: priced.items.map(i => { const c = cases.find(x => x.id === i.case_id); return { ...i, folio: c.folio, title: c.title, service_name: c.service_name }; })
  });

  // ---------- Resultado de Webpay ----------
  /** Reembolsa un cobro que no debe quedar en pie (monto distinto, trámite cambiado mientras se pagaba). */
  async function revert(order, tx, reason) {
    let refunded = false;
    try { await webpay.refund(order.token, tx.amount); refunded = true; } catch { /* queda registrado para gestión manual */ }
    await atomic(async () => {
      await run("UPDATE orders SET status='anulada', response_code=0, updated_at=? WHERE id=? AND status='procesando'", now(), order.id);
      await audit(order.client_id, refunded ? 'orden.reembolsada' : 'orden.reembolso_pendiente', 'orden', order.id, { reason, amount: tx.amount });
      await notify(order.client_id, null, refunded
        ? `El pago de la orden ${order.buy_order} no pudo aplicarse a tus trámites y fue reembolsado.`
        : `El pago de la orden ${order.buy_order} no pudo aplicarse a tus trámites. Contacta a Easy Office para gestionar el reembolso.`);
    });
  }

  async function applyResult(order, tx) {
    const charged = tx.status === 'AUTHORIZED' && tx.response_code === 0;
    if (!charged) {
      await atomic(async () => {
        const changed = await run("UPDATE orders SET status='rechazada', response_code=?, updated_at=? WHERE id=? AND status='procesando'", Number.isInteger(tx.response_code) ? tx.response_code : null, now(), order.id);
        if (!changed.changes) return;
        await audit(order.client_id, 'orden.rechazada', 'orden', order.id, { status: tx.status, response_code: tx.response_code });
        await notify(order.client_id, null, 'Tu pago con Webpay no fue aprobado. No se realizó ningún cobro. Puedes intentarlo de nuevo desde el carrito.');
      });
      return;
    }
    if (tx.buy_order !== order.buy_order || tx.amount !== order.total) return revert(order, tx, 'monto_o_orden_distinto');
    const outcome = await atomic(async () => {
      const o = await one('SELECT * FROM orders WHERE id=? FOR UPDATE', order.id);
      if (o.status !== 'procesando') return 'resuelta';
      const items = await all('SELECT * FROM order_items WHERE order_id=? ORDER BY case_id', order.id);
      const cases = await all('SELECT * FROM cases WHERE id = ANY(?) ORDER BY id FOR UPDATE', items.map(i => i.case_id));
      if (!cases.every(c => c.status === 'pendiente_pago')) return 'revertir';
      const stamp = now();
      for (const item of items) {
        const row = cases.find(c => c.id === item.case_id);
        await insert("INSERT INTO payments(case_id,amount,method,reference,status,submitted_by,reason,created_at,reviewed_at,order_id) VALUES(?,?,'webpay',?,'aprobado',?,?,?,?,?)",
          item.case_id, item.paid_amount, `${order.buy_order}-${item.case_id}`, order.client_id, `Webpay · autorización ${tx.authorization_code}`, stamp, stamp, order.id);
        await changeState({}, row, 'en_revision');
      }
      await run("UPDATE orders SET status='pagada', authorization_code=?, card_last4=?, payment_type=?, installments=?, response_code=0, updated_at=? WHERE id=?",
        String(tx.authorization_code ?? ''), String(tx.card_detail?.card_number ?? '').slice(-4), tx.payment_type_code ?? null, Number.isInteger(tx.installments_number) ? tx.installments_number : null, stamp, order.id);
      await audit(order.client_id, 'pago.webpay', 'orden', order.id, { buy_order: order.buy_order, total: order.total, discount: order.discount, coupon: order.coupon_code, cases: items.map(i => i.case_id) });
      await notify(order.client_id, null, `Pago recibido: ${clp(order.total)} (orden ${order.buy_order}). Tus trámites pasaron a revisión.`);
      return 'pagada';
    });
    if (outcome === 'revertir') await revert(order, tx, 'tramite_cambio_durante_el_pago');
  }

  /** Orden que quedó "procesando" (falló la red al confirmar): consulta a Webpay y la cierra. */
  async function reconcile(order) {
    if (order.status !== 'procesando' || !order.token || Date.now() - Date.parse(order.updated_at) < RECONCILE_AFTER_MS) return order;
    try {
      let tx = await webpay.status(order.token);
      if (tx.status === 'INITIALIZED') tx = await webpay.commit(order.token);
      if (['AUTHORIZED', 'FAILED'].includes(tx.status)) await applyResult(order, tx);
    } catch { /* se reintenta en la próxima consulta */ }
    return one('SELECT * FROM orders WHERE id=?', order.id);
  }

  // ---------- Retorno desde Webpay (el navegador llega sin sesión: se identifica por el token) ----------
  async function retorno(req, res) {
    const p = { ...req.query, ...(req.body || {}) };
    const str = x => (typeof x === 'string' ? x.slice(0, 200) : '');
    const token = str(p.token_ws), tbkToken = str(p.TBK_TOKEN);
    const back = order => res.redirect(303, front(`/cliente/carrito${order ? `?orden=${order.id}` : '?pago=error'}`));
    try {
      if (tbkToken) { // abandono, tiempo agotado o error en el formulario: sin confirmación Webpay no cobra
        const order = await one('SELECT * FROM orders WHERE token=?', tbkToken);
        if (order?.status === 'iniciada') {
          await atomic(async () => {
            await run("UPDATE orders SET status='anulada', updated_at=? WHERE id=? AND status='iniciada'", now(), order.id);
            await audit(order.client_id, 'orden.abandonada', 'orden', order.id);
          });
        }
        return back(order);
      }
      const order = token ? await one('SELECT * FROM orders WHERE token=?', token) : null;
      if (!order) return back(null);
      const claimed = await atomic(async () => {
        const o = await one('SELECT * FROM orders WHERE id=? FOR UPDATE', order.id);
        if (o.status === 'iniciada' && o.created_at < cutoff()) await run("UPDATE orders SET status='expirada', updated_at=? WHERE id=?", now(), o.id);
        if (o.status !== 'iniciada' || o.created_at < cutoff()) return false;
        await run("UPDATE orders SET status='procesando', updated_at=? WHERE id=?", now(), o.id);
        return true;
      });
      if (claimed) {
        let tx;
        try { tx = await webpay.commit(token); }
        catch { await audit(order.client_id, 'orden.commit_incierto', 'orden', order.id); return back(order); }
        await applyResult(order, tx);
      }
      return back(order);
    } catch (error) { console.error('Retorno Webpay:', error.code || error.message); return back(null); }
  }

  function mountPublic(app) {
    app.all('/api/webpay/retorno', express.urlencoded({ extended: false, limit: '10kb' }), retorno);
  }

  function mountPrivate(app) {
    app.get('/api/carrito', roles('cliente'), async (req, res) => {
      await expireStale();
      const items = await all("SELECT c.id,c.folio,c.title,c.service_name,c.amount FROM cases c WHERE c.client_id=? AND c.status='pendiente_pago' AND EXISTS(SELECT 1 FROM documents d WHERE d.case_id=c.id) ORDER BY c.id", req.user.id);
      const busy = new Set((await all("SELECT i.case_id FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.client_id=? AND o.status='procesando'", req.user.id)).map(r => r.case_id));
      res.json({ items: items.map(i => ({ ...i, en_proceso: busy.has(i.id) })), webpay: webpay.enabled });
    });

    app.post('/api/carrito/cotizar', roles('cliente'), async (req, res) => {
      await expireStale();
      res.json(quoteOf(await loadCart(req.user, req.body || {})));
    });

    app.post('/api/carrito/pagar', roles('cliente'), async (req, res) => {
      if (!webpay.enabled) v.fail(503, 'WEBPAY_NOT_CONFIGURED', 'Webpay no está configurado. No se realizó ningún cobro.');
      await expireStale();
      const buyOrder = newBuyOrder();
      const { orderId, priced } = await atomic(async () => {
        const cart = await loadCart(req.user, req.body || {}, true);
        if (await one("SELECT o.id FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.case_id = ANY(?) AND o.status='procesando'", cart.ids))
          v.fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso para alguno de estos trámites. Espera unos segundos.');
        // Un intento anterior sin concluir se descarta: sin confirmación, Webpay no cobra.
        await run("UPDATE orders SET status='anulada', updated_at=? WHERE client_id=? AND status='iniciada' AND id IN (SELECT order_id FROM order_items WHERE case_id = ANY(?))", now(), req.user.id, cart.ids);
        const stamp = now(), { priced } = cart;
        const id = await insert("INSERT INTO orders(buy_order,client_id,subtotal,discount,total,coupon_id,coupon_code,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'iniciada',?,?)",
          buyOrder, req.user.id, priced.subtotal, priced.discount, priced.total, cart.coupon?.id ?? null, cart.coupon?.code ?? null, stamp, stamp);
        for (const item of priced.items) await run('INSERT INTO order_items(order_id,case_id,amount,paid_amount) VALUES(?,?,?,?)', id, item.case_id, item.amount, item.paid_amount);
        await audit(req.user.id, 'orden.creada', 'orden', id, { cases: cart.ids, total: priced.total, coupon: cart.coupon?.code ?? null });
        return { orderId: id, priced };
      });
      let tx;
      try {
        tx = await webpay.create({ buyOrder, sessionId: String(req.user.id), amount: priced.total });
        if (typeof tx?.token !== 'string' || !/^https:\/\/webpay3g(int)?\.transbank\.cl\//.test(String(tx.url))) throw new v.ApiError(502, 'WEBPAY_ERROR', 'Respuesta inesperada de Webpay.');
      } catch (error) {
        await run("UPDATE orders SET status='anulada', updated_at=? WHERE id=?", now(), orderId);
        throw error;
      }
      await run('UPDATE orders SET token=?, updated_at=? WHERE id=?', tx.token, now(), orderId);
      res.status(201).json({ orderId, url: tx.url, token: tx.token, total: priced.total });
    });

    app.get('/api/ordenes/:id', roles('cliente', 'admin', 'finanzas'), async (req, res) => {
      const args = [v.id(req.params.id)];
      if (req.user.role === 'cliente') args.push(req.user.id);
      let order = await one(`SELECT * FROM orders WHERE id=?${req.user.role === 'cliente' ? ' AND client_id=?' : ''}`, ...args);
      if (!order) v.fail(404, 'NOT_FOUND', 'Orden no encontrada.');
      order = await reconcile(order);
      const { token, ...safe } = order;
      res.json({ ...safe, items: await all('SELECT i.case_id,i.amount,i.paid_amount,c.folio,c.title,c.service_name,c.status FROM order_items i JOIN cases c ON c.id=i.case_id WHERE i.order_id=? ORDER BY i.case_id', order.id) });
    });

    // ---------- Cupones (monto fijo) ----------
    app.get('/api/cupones', roles('admin'), async (req, res) => {
      res.json({ items: await all("SELECT c.*,(SELECT COUNT(*) FROM orders o WHERE o.coupon_id=c.id AND o.status='pagada') AS used FROM coupons c ORDER BY c.id DESC") });
    });
    app.post('/api/cupones', roles('admin'), async (req, res) => {
      const b = req.body || {}, code = v.text(b.code, 'code', 30, 3).toUpperCase();
      if (!/^[A-Z0-9_-]+$/.test(code)) v.fail(400, 'VALIDATION_ERROR', 'code: solo letras, números, guion y guion bajo.');
      const amount = v.integer(b.amount, 'amount', 1, 10000000);
      const maxUses = b.maxUses === undefined || b.maxUses === null ? null : v.integer(b.maxUses, 'maxUses', 1, 1000000);
      const oncePerClient = b.oncePerClient === undefined ? 1 : v.bool(b.oncePerClient, 'oncePerClient');
      let expiresAt = null;
      if (b.expiresAt !== undefined && b.expiresAt !== null) {
        const t = Date.parse(v.text(b.expiresAt, 'expiresAt', 40));
        if (Number.isNaN(t)) v.fail(400, 'VALIDATION_ERROR', 'expiresAt: fecha inválida (ISO 8601).');
        expiresAt = new Date(t).toISOString();
      }
      const id = await atomic(async () => {
        const couponId = await insert('INSERT INTO coupons(code,amount,max_uses,once_per_client,expires_at,created_at) VALUES(?,?,?,?,?,?)', code, amount, maxUses, oncePerClient, expiresAt, now());
        await audit(req.user.id, 'cupon.creado', 'cupon', couponId, { code, amount, maxUses, oncePerClient, expiresAt });
        return couponId;
      });
      res.status(201).json(await one('SELECT * FROM coupons WHERE id=?', id));
    });
    app.patch('/api/cupones/:id', roles('admin'), async (req, res) => {
      const id = v.id(req.params.id), active = v.bool(req.body?.active, 'active');
      if (!await one('SELECT id FROM coupons WHERE id=?', id)) v.fail(404, 'NOT_FOUND', 'Cupón no encontrado.');
      await atomic(async () => { await run('UPDATE coupons SET active=? WHERE id=?', active, id); await audit(req.user.id, 'cupon.estado', 'cupon', id, { active }); });
      res.json(await one('SELECT * FROM coupons WHERE id=?', id));
    });
  }

  return { mountPublic, mountPrivate, expireStale };
}

module.exports = { createCheckout };