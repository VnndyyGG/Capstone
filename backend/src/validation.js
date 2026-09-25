class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new ApiError(status, code, message); }
function text(value, name, max = 200, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    fail(400, 'VALIDATION_ERROR', `${name}: se requieren entre ${min} y ${max} caracteres.`);
  return value.trim();
}
function integer(value, name, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(400, 'VALIDATION_ERROR', `${name}: entero entre ${min} y ${max}.`);
  return value;
}
function id(value) {
  if (!/^\d+$/.test(String(value))) fail(400, 'VALIDATION_ERROR', 'Identificador inválido.');
  return integer(Number(value), 'id');
}
function email(value) {
  const result = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'VALIDATION_ERROR', 'Correo inválido.');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    fail(400, 'VALIDATION_ERROR', 'La contraseña debe tener entre 12 y 128 caracteres.');
  return value;
}
function bool(value, name) {
  if (typeof value !== 'boolean') fail(400, 'VALIDATION_ERROR', `${name}: booleano requerido.`);
  return value ? 1 : 0;
}
function rut(value = '') {
  if (value === '') return '';
  const normalized = text(value, 'rut', 15).replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(normalized)) fail(400, 'VALIDATION_ERROR', 'RUT inválido.');
  const body = normalized.slice(0, -1);
  let sum = 0, factor = 2;
  for (const digit of [...body].reverse()) { sum += Number(digit) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const remainder = 11 - sum % 11;
  if ((remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder)) !== normalized.at(-1))
    fail(400, 'VALIDATION_ERROR', 'Dígito verificador del RUT inválido.');
  return `${body}-${normalized.at(-1)}`;
}
function pagination(query) {
  return { limit: query.limit === undefined ? 50 : integer(Number(query.limit), 'limit', 1, 100),
    offset: query.offset === undefined ? 0 : integer(Number(query.offset), 'offset', 0, 1000000) };
}
module.exports = { ApiError, fail, text, integer, id, email, password, bool, rut, pagination };
