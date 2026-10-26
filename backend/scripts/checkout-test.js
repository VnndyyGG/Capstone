// Prueba de integración: necesita una base PostgreSQL con db/schema.sql cargado.
//   TEST_DATABASE_URL=postgres://usuario:clave@127.0.0.1:5432/easyoffice node --test test/checkout.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/security');

const url = process.env.TEST_DATABASE_URL;
const sufijo = randomBytes(3).toString('hex');

test('carrito + cupón + Webpay (simulado)', { skip: !url && 'defina TEST_DATABASE_URL' }, async t => {
  const db = await openDatabase(url);
  // Webpay simulado: el comportamiento de commit lo decide cada prueba.
  const tokens = new Map(); let commits = 0, refunds = 0, nextCommit = null;
  const webpay = {
    enabled: true,
    create: async ({ buyOrder, amount }) => { const token = randomBytes(32).toString('hex'); tokens.set(token, { buyOrder, amount }); return { token, url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }; },
    commit: async token => { commits++; const o = tokens.get(token); return nextCommit ? nextCommit(o) : { status: 'AUTHORIZED', response_code: 0, buy_order: o.buyOrder, amount: o.amount, authorization_code: '1213', payment_type_code: 'VN', installments_number: 0, card_detail: { card_number: '6623' } }; },
    status: async () => ({ status: 'INITIALIZED' }),
    refund: async () => { refunds++; return { type: 'REVERSED' }; }
  };
  const server = createApp(db, { webpay, origins: 'http://localhost:4200' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const call = async (method, path, token, body, extra = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* texto o redirección */ }
    return { status: res.status, json, text, location: res.headers.get('location') };
  };

  // Admin, cliente, servicios y cupón
  const pass = 'clave-de-prueba-123';
  await db.run("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,'admin',?)", 'Admin T', `admin-${sufijo}@example.test`, await hashPassword(pass), new Date().toISOString());
  const admin = (await call('POST', '/api/auth/login', null, { email: `admin-${sufijo}@example.test`, password: pass })).json.token;
  const cliente = (await call('POST', '/api/auth/register', null, { name: 'Cliente T', email: `cli-${sufijo}@example.test`, password: pass })).json.token;
  const otro = (await call('POST', '/api/auth/register', null, { name: 'Otro T', email: `otro-${sufijo}@example.test`, password: pass })).json.token;
  const svcA = (await call('POST', '/api/servicios', admin, { name: 'Servicio A', price: 15000, requiresSignature: false })).json.id;
  const svcB = (await call('POST', '/api/servicios', admin, { name: 'Servicio B', price: 22000, requiresSignature: false })).json.id;
  const code = `TEST${sufijo}`.toUpperCase();
  assert.equal((await call('POST', '/api/cupones', admin, { code, amount: 5000, maxUses: 5 })).status, 201);
  assert.equal((await call('POST', '/api/cupones', cliente, { code: 'X'.repeat(5), amount: 1 })).status, 403);

  const listoParaPagar = async svc => {
    const c = (await call('POST', '/api/tramites', cliente, { serviceId: svc })).json;
    assert.equal((await call('POST', `/api/tramites/${c.id}/documentos`, cliente, { content: 'Documento de prueba', expectedVersion: 0 })).status, 201);
    assert.equal((await call('PATCH', `/api/tramites/${c.id}/estado`, cliente, { status: 'pendiente_pago' })).status, 200);
    return c.id;
  };
  const a = await listoParaPagar(svcA), b = await listoParaPagar(svcB);

  await t.test('carrito y cotización', async () => {
    const cart = (await call('GET', '/api/carrito', cliente)).json;
    assert.deepEqual(cart.items.map(i => i.id).sort(), [a, b].sort());
    const q = (await call('POST', '/api/carrito/cotizar', cliente, { caseIds: [a, b], coupon: code.toLowerCase() })).json;
    assert.deepEqual([q.subtotal, q.discount, q.total], [37000, 5000, 32000]);
    assert.equal(q.items.reduce((s, i) => s + i.paid_amount, 0), 32000);
    assert.equal((await call('POST', '/api/carrito/cotizar', cliente, { caseIds: [a], coupon: 'NOEXISTE' })).status, 409);
    assert.equal((await call('POST', '/api/carrito/cotizar', otro, { caseIds: [a] })).status, 404); // trámite ajeno
    assert.equal((await call('POST', '/api/carrito/cotizar', cliente, { caseIds: [a, a] })).status, 400);
  });

  let orden;
  await t.test('pago aprobado: un solo cobro por todo el carrito, con cupón', async () => {
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [a, b], coupon: code, total: 1 }); // "total" del cliente se ignora
    assert.equal(r.status, 201);
    assert.equal(r.json.total, 32000);
    orden = r.json.orderId;
    // Webpay devuelve al navegador con Origin de Transbank y sin sesión
    const back = await call('GET', `/api/webpay/retorno?token_ws=${r.json.token}`, null, null, { Origin: 'https://webpay3gint.transbank.cl' });
    assert.equal(back.status, 303);
    assert.equal(back.location, `http://localhost:4200/cliente/carrito?orden=${orden}`);
    const o = (await call('GET', `/api/ordenes/${orden}`, cliente)).json;
    assert.equal(o.status, 'pagada'); assert.equal(o.card_last4, '6623'); assert.equal(o.token, undefined);
    assert.equal(o.items.length, 2); assert.ok(o.items.every(i => i.status === 'en_revision'));
    const pagos = (await call('GET', '/api/pagos', cliente)).json.items.filter(p => p.order_id === orden);
    assert.equal(pagos.reduce((s, p) => s + p.amount, 0), 32000);
    assert.ok(pagos.every(p => p.method === 'webpay' && p.status === 'aprobado'));
    const comp = await call('GET', `/api/pagos/${pagos[0].id}/comprobante`, cliente);
    assert.match(comp.text, /Autorización: 1213/);
    // Repetir el retorno no cobra ni duplica nada
    const before = commits;
    await call('GET', `/api/webpay/retorno?token_ws=${r.json.token}`, null);
    assert.equal(commits, before);
    assert.equal((await call('GET', '/api/pagos', cliente)).json.items.filter(p => p.order_id === orden).length, 2);
  });

  await t.test('el cupón de un solo uso por cliente no se reutiliza', async () => {
    const c = await listoParaPagar(svcA);
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c], coupon: code });
    assert.equal(r.status, 409); assert.match(r.json.error.message, /Ya usaste/);
    assert.equal((await call('POST', '/api/carrito/pagar', cliente, { caseIds: [a] })).status, 409); // a ya está pagado
  });

  await t.test('pago rechazado: el trámite sigue pendiente y se puede reintentar', async () => {
    const c = await listoParaPagar(svcA);
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c] });
    nextCommit = () => ({ status: 'FAILED', response_code: -1 });
    await call('GET', `/api/webpay/retorno?token_ws=${r.json.token}`, null);
    nextCommit = null;
    assert.equal((await call('GET', `/api/ordenes/${r.json.orderId}`, cliente)).json.status, 'rechazada');
    assert.equal((await call('GET', `/api/tramites/${c}`, cliente)).json.status, 'pendiente_pago');
    const r2 = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c] });
    assert.equal(r2.status, 201);
    await call('GET', `/api/webpay/retorno?token_ws=${r2.json.token}`, null);
    assert.equal((await call('GET', `/api/tramites/${c}`, cliente)).json.status, 'en_revision');
  });

  await t.test('abandono en el formulario de Webpay: anulada, sin commit', async () => {
    const c = await listoParaPagar(svcB);
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c] });
    const before = commits;
    const back = await call('POST', '/api/webpay/retorno', null, null, { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://webpay3gint.transbank.cl' });
    assert.equal(back.status, 303); // sin parámetros: vuelve al carrito con error
    await fetch(base + '/api/webpay/retorno', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `TBK_TOKEN=${r.json.token}&TBK_ORDEN_COMPRA=x&TBK_ID_SESION=y` });
    assert.equal(commits, before);
    assert.equal((await call('GET', `/api/ordenes/${r.json.orderId}`, cliente)).json.status, 'anulada');
    assert.equal((await call('GET', `/api/tramites/${c}`, cliente)).json.status, 'pendiente_pago');
  });

  await t.test('monto distinto al esperado: se reembolsa y no se aprueba nada', async () => {
    const c = await listoParaPagar(svcA);
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c] });
    nextCommit = o => ({ status: 'AUTHORIZED', response_code: 0, buy_order: o.buyOrder, amount: 1, authorization_code: '9' });
    await call('GET', `/api/webpay/retorno?token_ws=${r.json.token}`, null);
    nextCommit = null;
    assert.equal(refunds, 1);
    assert.equal((await call('GET', `/api/ordenes/${r.json.orderId}`, cliente)).json.status, 'anulada');
    assert.equal((await call('GET', `/api/tramites/${c}`, cliente)).json.status, 'pendiente_pago');
  });

  await t.test('cancelar o volver a editar descarta un intento sin concluir', async () => {
    const c = await listoParaPagar(svcA);
    const r = await call('POST', '/api/carrito/pagar', cliente, { caseIds: [c] });
    assert.equal((await call('PATCH', `/api/tramites/${c}/estado`, cliente, { status: 'borrador' })).status, 200);
    assert.equal((await call('GET', `/api/ordenes/${r.json.orderId}`, cliente)).json.status, 'anulada');
    const before = commits;
    await call('GET', `/api/webpay/retorno?token_ws=${r.json.token}`, null); // pagar en la pestaña vieja ya no cobra
    assert.equal(commits, before);
  });
});