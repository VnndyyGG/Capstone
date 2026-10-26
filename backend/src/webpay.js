const { randomBytes } = require('node:crypto');
const { ApiError } = require('./validation');

// Credenciales públicas de integración (documentación de Transbank). Verifícalas en https://transbankdevelopers.cl/referencia
const INTEGRATION = {
  host: 'https://webpay3gint.transbank.cl',
  commerceCode: '597055555532',
  apiKey: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C'
};
const PRODUCTION_HOST = 'https://webpay3g.transbank.cl';
const BASE = '/rswebpaytransaction/api/webpay/v1.2/transactions';

/** WEBPAY_ENV=integration usa las credenciales de prueba; production exige código y llave propios. Sin WEBPAY_ENV, Webpay queda deshabilitado. */
function readConfig(env = process.env) {
  const mode = (env.WEBPAY_ENV || '').toLowerCase();
  const returnUrl = env.WEBPAY_RETURN_URL || '';
  if (!returnUrl) return null;
  if (mode === 'integration') return { mode, ...INTEGRATION, returnUrl };
  if (mode === 'production' && env.WEBPAY_COMMERCE_CODE && env.WEBPAY_API_KEY)
    return { mode, host: PRODUCTION_HOST, commerceCode: env.WEBPAY_COMMERCE_CODE, apiKey: env.WEBPAY_API_KEY, returnUrl };
  return null;
}

/** buy_order de Webpay: máx. 26 caracteres, único por intento de pago. */
const newBuyOrder = () => 'EO' + Date.now().toString(36) + randomBytes(4).toString('hex');

function createWebpay({ config = readConfig(), fetchFn = globalThis.fetch } = {}) {
  const enabled = Boolean(config);
  const call = async (method, path, body) => {
    if (!enabled) throw new ApiError(503, 'WEBPAY_NOT_CONFIGURED', 'Webpay no está configurado. No se realizó ningún cobro.');
    let res;
    try {
      res = await fetchFn(config.host + BASE + path, {
        method,
        headers: { 'Tbk-Api-Key-Id': config.commerceCode, 'Tbk-Api-Key-Secret': config.apiKey, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000)
      });
    } catch { throw new ApiError(502, 'WEBPAY_UNREACHABLE', 'No se pudo comunicar con Webpay. Intenta nuevamente.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('Webpay HTTP', res.status, method, path.replace(/\/[0-9a-f]{40,}/, '/<token>')); throw new ApiError(502, 'WEBPAY_ERROR', 'Webpay rechazó la solicitud.'); }
    return data;
  };
  return {
    enabled, mode: config?.mode, returnUrl: config?.returnUrl,
    create: ({ buyOrder, sessionId, amount }) => call('POST', '', { buy_order: buyOrder, session_id: sessionId, amount, return_url: config?.returnUrl }),
    commit: token => call('PUT', '/' + encodeURIComponent(token)),
    status: token => call('GET', '/' + encodeURIComponent(token)),
    refund: (token, amount) => call('POST', '/' + encodeURIComponent(token) + '/refunds', { amount })
  };
}

module.exports = { createWebpay, readConfig, newBuyOrder };