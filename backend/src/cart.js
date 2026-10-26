// Cálculo del carrito: puro (sin base de datos ni red) para poder probarlo en aislamiento.
const MIN_TOTAL = 1000; // CLP. El cupón nunca deja el total por debajo de este monto.

/**
 * items: [{ case_id, amount }]  (precios de lista, desde la base de datos)
 * coupon: { amount } | null     (cupón de monto fijo ya validado)
 * Devuelve subtotal, descuento aplicado, total y el descuento repartido por trámite (prorrateo + resto en pesos).
 */
function priceCart(items, coupon = null) {
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const discount = coupon ? Math.min(coupon.amount, Math.max(0, subtotal - MIN_TOTAL)) : 0;
  const lines = items.map(i => ({ case_id: i.case_id, amount: i.amount, share: Math.floor(discount * i.amount / subtotal) }));
  let rest = discount - lines.reduce((sum, l) => sum + l.share, 0);
  // El resto (menos de un peso por trámite) se reparte de a uno, sin dejar ningún trámite en $0.
  for (let i = 0; rest > 0 && lines.some(l => l.amount - l.share > 1); i++) {
    const line = lines[i % lines.length];
    if (line.amount - line.share > 1) { line.share++; rest--; }
  }
  const out = lines.map(l => ({ case_id: l.case_id, amount: l.amount, paid_amount: l.amount - l.share }));
  return { subtotal, discount, total: subtotal - discount, items: out };
}

/** Mensaje de error si el cupón no puede usarse; null si es válido. Mensaje único para no revelar qué cupones existen. */
function couponProblem(coupon, { now = new Date().toISOString(), uses = 0, usesByClient = 0 } = {}) {
  if (!coupon || !coupon.active || (coupon.expires_at && coupon.expires_at <= now)) return 'Cupón no válido o vencido.';
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && uses >= coupon.max_uses) return 'Cupón no válido o vencido.';
  if (coupon.once_per_client && usesByClient > 0) return 'Ya usaste este cupón.';
  return null;
}

module.exports = { MIN_TOTAL, priceCart, couponProblem };