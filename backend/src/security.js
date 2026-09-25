const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const computed = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === computed.length && timingSafeEqual(expected, computed);
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomBytes(32).toString('hex'); }
function profile(user) {
  const labels = { cliente: 'Cliente', admin: 'Ejecutivo · Administración', comercial: 'Ejecutivo · Comercial', finanzas: 'Ejecutivo · Finanzas' };
  const crumbs = { cliente: 'Mis trámites', admin: 'Panel de administración', comercial: 'Trámites asignados', finanzas: 'Pagos y reportes' };
  return { id: user.id, name: user.name, email: user.email, rut: user.rut, tipo: user.role,
    role: labels[user.role], initials: user.name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(),
    avatarBg: { cliente: '#15803D', admin: '#6D28D9', comercial: '#1D4ED8', finanzas: '#B45309' }[user.role],
    crumb: crumbs[user.role], active: Boolean(user.active) };
}
module.exports = { hashPassword, verifyPassword, digest, token, profile };
