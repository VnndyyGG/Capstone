const test = require('node:test');
const assert = require('node:assert/strict');
const { priceCart, couponProblem, MIN_TOTAL } = require('../src/cart');

test('sin cupón: total = subtotal', () => {
  const r = priceCart([{ case_id: 1, amount: 15000 }, { case_id: 2, amount: 22000 }]);
  assert.deepEqual([r.subtotal, r.discount, r.total], [37000, 0, 37000]);
});

test('cupón fijo se prorratea y la suma cuadra exacto', () => {
  const r = priceCart([{ case_id: 1, amount: 15000 }, { case_id: 2, amount: 22000 }, { case_id: 3, amount: 9990 }], { amount: 5000 });
  assert.equal(r.discount, 5000);
  assert.equal(r.items.reduce((s, i) => s + i.paid_amount, 0), r.total);
  assert.equal(r.total, 46990 - 5000);
  assert.ok(r.items.every(i => i.paid_amount > 0 && i.paid_amount <= i.amount));
});

test('el cupón nunca deja el total bajo el mínimo', () => {
  const r = priceCart([{ case_id: 1, amount: 3000 }], { amount: 5000 });
  assert.equal(r.total, MIN_TOTAL);
  assert.equal(r.discount, 2000);
});

test('subtotal menor al mínimo: el cupón no descuenta nada', () => {
  assert.equal(priceCart([{ case_id: 1, amount: 800 }], { amount: 500 }).discount, 0);
});

test('ningún trámite queda en $0 aunque el resto del prorrateo sea grande', () => {
  const r = priceCart([{ case_id: 1, amount: 1 }, { case_id: 2, amount: 1 }, { case_id: 3, amount: 2000 }], { amount: 1500 });
  assert.ok(r.items.every(i => i.paid_amount >= 1));
  assert.equal(r.items.reduce((s, i) => s + i.paid_amount, 0), r.total);
});

test('validación de cupón', () => {
  const ok = { active: 1, expires_at: null, max_uses: null, once_per_client: 1 };
  assert.equal(couponProblem(ok), null);
  assert.ok(couponProblem(null));
  assert.ok(couponProblem({ ...ok, active: 0 }));
  assert.ok(couponProblem({ ...ok, expires_at: '2020-01-01T00:00:00.000Z' }));
  assert.ok(couponProblem({ ...ok, max_uses: 3 }, { uses: 3 }));
  assert.equal(couponProblem({ ...ok, max_uses: 3 }, { uses: 2 }), null);
  assert.ok(couponProblem(ok, { usesByClient: 1 }));
  assert.equal(couponProblem({ ...ok, once_per_client: 0 }, { usesByClient: 5 }), null);
});