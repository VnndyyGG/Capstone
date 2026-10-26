const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebpay, readConfig, newBuyOrder } = require('../src/webpay');

test('sin WEBPAY_ENV o sin URL de retorno queda deshabilitado', () => {
  assert.equal(readConfig({}), null);
  assert.equal(readConfig({ WEBPAY_ENV: 'integration' }), null);
  assert.equal(readConfig({ WEBPAY_ENV: 'production', WEBPAY_RETURN_URL: 'https://x/y' }), null); // exige código y llave propios
  assert.equal(createWebpay({ config: null }).enabled, false);
});

test('integración usa el host y comercio de prueba; producción el host real', () => {
  const i = readConfig({ WEBPAY_ENV: 'integration', WEBPAY_RETURN_URL: 'http://localhost:3000/api/webpay/retorno' });
  assert.equal(i.host, 'https://webpay3gint.transbank.cl'); assert.equal(i.commerceCode, '597055555532');
  const p = readConfig({ WEBPAY_ENV: 'production', WEBPAY_COMMERCE_CODE: '1', WEBPAY_API_KEY: 'k', WEBPAY_RETURN_URL: 'https://x/y' });
  assert.equal(p.host, 'https://webpay3g.transbank.cl');
});

test('crear y confirmar llaman a la ruta REST v1.2 con las cabeceras de autenticación', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, ...init }); return { ok: true, json: async () => ({ token: 't', url: 'u' }) }; };
  const w = createWebpay({ config: readConfig({ WEBPAY_ENV: 'integration', WEBPAY_RETURN_URL: 'http://localhost:3000/r' }), fetchFn });
  await w.create({ buyOrder: 'EO1', sessionId: '7', amount: 32000 });
  await w.commit('abc');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions');
  assert.equal(calls[0].headers['Tbk-Api-Key-Id'], '597055555532');
  assert.deepEqual(JSON.parse(calls[0].body), { buy_order: 'EO1', session_id: '7', amount: 32000, return_url: 'http://localhost:3000/r' });
  assert.equal(calls[1].method, 'PUT'); assert.ok(calls[1].url.endsWith('/transactions/abc'));
});

test('errores de Webpay no filtran detalles al cliente', async () => {
  const w = createWebpay({ config: readConfig({ WEBPAY_ENV: 'integration', WEBPAY_RETURN_URL: 'http://x/r' }), fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ error_message: 'secreto' }) }) });
  await assert.rejects(w.commit('abc'), e => e.status === 502 && !/secreto/.test(e.message));
});

test('buy_order cumple el máximo de 26 caracteres y no se repite', () => {
  const a = newBuyOrder(), b = newBuyOrder();
  assert.ok(a.length <= 26); assert.notEqual(a, b);
});