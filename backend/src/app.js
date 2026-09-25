const express = require('express');
const { transaction } = require('./db');
const { hashPassword, verifyPassword, digest, token, profile } = require('./security');
const v = require('./validation');
const now = () => new Date().toISOString();
const ROLES = ['cliente', 'admin', 'comercial', 'finanzas'];

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  const origins = (options.origins || process.env.CORS_ORIGINS || 'http://localhost:4200').split(',').map(x => x.trim());
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const atomic = fn => transaction(db, fn);
  const audit = (actor, action, entity, entityId = null, metadata = {}) => run(
    'INSERT INTO audit(actor_id,action,entity,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?)',
    actor, action, entity, entityId, JSON.stringify(metadata), now());
  const notify = (userId, caseId, message) => run('INSERT INTO notifications(user_id,case_id,message,created_at) VALUES(?,?,?,?)', userId, caseId, message, now());
  const roles = (...allowed) => (req, res, next) => {
    if (!allowed.includes(req.user.role)) return next(new v.ApiError(403, 'FORBIDDEN', 'Tu rol no permite esta acción.'));
    next();
  };
  const issueSession = user => {
    const accessToken = token();
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', digest(accessToken), user.id, expiresAt);
    return { token: accessToken, expiresAt: new Date(expiresAt).toISOString(), perfil: profile(user) };
  };
  const caseFor = (req, write = false) => {
    const caseId = v.id(req.params.id);
    let row;
    if (req.user.role === 'cliente') row = one('SELECT * FROM cases WHERE id=? AND client_id=?', caseId, req.user.id);
    else if (req.user.role === 'comercial') row = one('SELECT * FROM cases WHERE id=? AND assigned_id=?', caseId, req.user.id);
    else if (req.user.role === 'admin') row = one('SELECT * FROM cases WHERE id=?', caseId);
    else v.fail(403, 'FORBIDDEN', 'Finanzas no tiene acceso al contenido de trámites.');
    if (!row) v.fail(404, 'NOT_FOUND', 'Trámite no encontrado.');
    if (write && ['cancelado', 'firmado', 'entregado', 'completado'].includes(row.status)) v.fail(409, 'CASE_LOCKED', 'El trámite ya no admite modificaciones.');
    return row;
  };
  const changeState = (req, row, state, reason = '') => {
    run('UPDATE cases SET status=?, updated_at=? WHERE id=?', state, now(), row.id);
    audit(req.user.id, 'tramite.estado', 'tramite', row.id, { from: row.status, to: state, reason });
    notify(row.client_id, row.id, `El trámite ${row.folio} cambió a ${state}.`);
  };
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    if (origin) {
      if (!origins.includes(origin)) return next(new v.ApiError(403, 'ORIGIN_DENIED', 'Origen no permitido.'));
      res.set('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '3mb', strict: true }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/capabilities', (req, res) => res.json({ payments: { transferencia: true, webpay: false }, firmaElectronicaAvanzada: false, notifications: 'in_app', storage: 'sqlite' }));
  const authLimit = (req, res, next) => {
    // No confiar en X-Forwarded-For enviado por el cliente. Configurar proxy de confianza antes de desplegar.
    const key = digest(req.ip || 'unknown');
    const time = Date.now();
    run('DELETE FROM login_attempts WHERE reset_at <= ?', time);
    const result = one('SELECT * FROM login_attempts WHERE key=?', key);
    if (result && result.count >= 20) {
      res.set('Retry-After', String(Math.ceil((result.reset_at - time) / 1000)));
      return next(new v.ApiError(429, 'RATE_LIMIT', 'Demasiados intentos. Intenta en 15 minutos.'));
    }
    run('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, time + 15 * 60 * 1000);
    next();
  };
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const b = req.body || {};
    const name = v.text(b.name, 'name', 120), email = v.email(b.email), rut = v.rut(b.rut);
    const hash = await hashPassword(v.password(b.password));
    const result = atomic(() => {
      if (one('SELECT id FROM users WHERE email=?', email)) v.fail(409, 'EMAIL_EXISTS', 'El correo ya está registrado.');
      const created = run('INSERT INTO users(name,email,password_hash,rut,role,created_at) VALUES(?,?,?,?,?,?)', name, email, hash, rut, 'cliente', now());
      const user = one('SELECT * FROM users WHERE id=?', Number(created.lastInsertRowid));
      audit(user.id, 'usuario.registro', 'usuario', user.id);
      return issueSession(user);
    });
    res.status(201).json(result);
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const b = req.body || {};
    const email = v.email(b.email);
    if (typeof b.password !== 'string' || b.password.length > 128) v.fail(400, 'VALIDATION_ERROR', 'Contraseña inválida.');
    const user = one('SELECT * FROM users WHERE email=?', email);
    const hash = user?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await verifyPassword(b.password, hash);
    if (!user || !user.active || !valid) { audit(null, 'auth.fallo', 'sesion'); v.fail(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.'); }
    // Releer tras scrypt asíncrono para respetar desactivaciones concurrentes.
    const current = one('SELECT * FROM users WHERE id=?', user.id);
    if (!current.active || current.password_hash !== hash) v.fail(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
    const result = atomic(() => { audit(user.id, 'auth.login', 'usuario', user.id); return issueSession(current); });
    res.json(result);
  });
  app.use('/api', (req, res, next) => {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('Authorization') || '');
    if (!match) return next(new v.ApiError(401, 'UNAUTHENTICATED', 'Inicia sesión.'));
    req.sessionHash = digest(match[1]);
    req.user = one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1', req.sessionHash, Date.now());
    if (!req.user) return next(new v.ApiError(401, 'UNAUTHENTICATED', 'La sesión expiró o fue revocada.'));
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ perfil: profile(req.user) }));
  app.post('/api/auth/logout', (req, res) => {
    atomic(() => { run('DELETE FROM sessions WHERE token_hash=?', req.sessionHash); audit(req.user.id, 'auth.logout', 'usuario', req.user.id); });
    res.sendStatus(204);
  });
  app.post('/api/auth/password', async (req, res) => {
    const b = req.body || {};
    if (typeof b.currentPassword !== 'string' || b.currentPassword.length > 128 || !await verifyPassword(b.currentPassword, req.user.password_hash)) v.fail(401, 'INVALID_CREDENTIALS', 'Contraseña actual incorrecta.');
    const hash = await hashPassword(v.password(b.newPassword));
    atomic(() => {
      const current = one('SELECT * FROM users WHERE id=?', req.user.id);
      if (!current.active || current.password_hash !== req.user.password_hash) v.fail(409, 'USER_CHANGED', 'El usuario cambió. Inicia sesión nuevamente.');
      run('UPDATE users SET password_hash=? WHERE id=?', hash, req.user.id);
      run('DELETE FROM sessions WHERE user_id=?', req.user.id);
      audit(req.user.id, 'auth.password', 'usuario', req.user.id);
    });
    res.sendStatus(204);
  });
  app.get('/api/usuarios', roles('admin'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    res.json({ items: all('SELECT * FROM users ORDER BY id LIMIT ? OFFSET ?', limit, offset).map(profile) });
  });
  app.post('/api/usuarios', roles('admin'), async (req, res) => {
    const b = req.body || {};
    const name = v.text(b.name, 'name', 120), email = v.email(b.email), rut = v.rut(b.rut);
    if (!ROLES.includes(b.tipo)) v.fail(400, 'VALIDATION_ERROR', 'Rol inválido.');
    const hash = await hashPassword(v.password(b.password));
    const result = atomic(() => {
      // La autorización se vuelve a comprobar tras la operación asíncrona.
      const actor = one('SELECT * FROM users WHERE id=?', req.user.id);
      if (!actor.active || actor.role !== 'admin') v.fail(403, 'FORBIDDEN', 'Permiso revocado.');
      if (one('SELECT id FROM users WHERE email=?', email)) v.fail(409, 'EMAIL_EXISTS', 'El correo ya está registrado.');
      const created = run('INSERT INTO users(name,email,password_hash,rut,role,created_at) VALUES(?,?,?,?,?,?)', name, email, hash, rut, b.tipo, now());
      const userId = Number(created.lastInsertRowid);
      audit(req.user.id, 'usuario.creado', 'usuario', userId, { role: b.tipo });
      return profile(one('SELECT * FROM users WHERE id=?', userId));
    });
    res.status(201).json(result);
  });
  app.patch('/api/usuarios/:id', roles('admin'), (req, res) => {
    const userId = v.id(req.params.id), b = req.body || {};
    const user = one('SELECT * FROM users WHERE id=?', userId);
    if (!user) v.fail(404, 'NOT_FOUND', 'Usuario no encontrado.');
    const active = b.active === undefined ? user.active : v.bool(b.active, 'active');
    const name = b.name === undefined ? user.name : v.text(b.name, 'name', 120);
    const role = b.tipo === undefined ? user.role : b.tipo;
    if (!ROLES.includes(role)) v.fail(400, 'VALIDATION_ERROR', 'Rol inválido.');
    if (userId === req.user.id && (!active || role !== 'admin')) v.fail(409, 'SELF_CHANGE', 'No puedes desactivar tu propio acceso administrativo.');
    if (role !== user.role && one('SELECT id FROM cases WHERE client_id=? OR assigned_id=? LIMIT 1', userId, userId)) v.fail(409, 'ROLE_IN_USE', 'Este usuario tiene trámites asociados; conserva su rol.');
    if (!active && one("SELECT id FROM cases WHERE assigned_id=? AND status NOT IN ('completado','entregado','cancelado') LIMIT 1", userId)) v.fail(409, 'ASSIGNED_CASES', 'Reasigna sus trámites activos antes de desactivarlo.');
    atomic(() => {
      run('UPDATE users SET name=?,role=?,active=? WHERE id=?', name, role, active, userId);
      if (!active || role !== user.role) run('DELETE FROM sessions WHERE user_id=?', userId);
      audit(req.user.id, 'usuario.actualizado', 'usuario', userId, { role, active });
    });
    res.json(profile(one('SELECT * FROM users WHERE id=?', userId)));
  });
  app.get('/api/clientes', roles('admin', 'comercial'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    const q = v.text(req.query.q || '', 'q', 120, 0);
    if (req.user.role === 'comercial' && q.length < 3) v.fail(400, 'VALIDATION_ERROR', 'Busca con al menos 3 caracteres.');
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const items = all("SELECT id,name,email,rut FROM users WHERE role='cliente' AND (name LIKE ? ESCAPE '\\' OR rut LIKE ? ESCAPE '\\') ORDER BY id LIMIT ? OFFSET ?", pattern, pattern, limit, offset);
    audit(req.user.id, 'cliente.busqueda', 'usuario', null, { query: q, count: items.length });
    res.json({ items });
  });
  app.get('/api/clientes/:id/tramites', roles('admin', 'comercial'), (req, res) => {
    const clientId = v.id(req.params.id), { limit, offset } = v.pagination(req.query);
    const items = all('SELECT id,folio,service_name,title,status,assigned_id,created_at FROM cases WHERE client_id=? ORDER BY id DESC LIMIT ? OFFSET ?', clientId, limit, offset);
    audit(req.user.id, 'cliente.tramites.consulta', 'usuario', clientId);
    res.json({ items });
  });
  app.get('/api/servicios', (req, res) => res.json({ items: all('SELECT * FROM services WHERE active=1 ORDER BY id') }));
  app.post('/api/servicios', roles('admin'), (req, res) => {
    const b = req.body || {}, name = v.text(b.name, 'name', 120), price = v.integer(b.price, 'price', 1, 100000000), signature = v.bool(b.requiresSignature, 'requiresSignature');
    const serviceId = atomic(() => {
      const result = run('INSERT INTO services(name,price,requires_signature) VALUES(?,?,?)', name, price, signature);
      const id = Number(result.lastInsertRowid); audit(req.user.id, 'servicio.creado', 'servicio', id); return id;
    });
    res.status(201).json(one('SELECT * FROM services WHERE id=?', serviceId));
  });
  app.patch('/api/servicios/:id', roles('admin'), (req, res) => {
    const serviceId = v.id(req.params.id), s = one('SELECT * FROM services WHERE id=?', serviceId), b = req.body || {};
    if (!s) v.fail(404, 'NOT_FOUND', 'Servicio no encontrado.');
    const name = b.name === undefined ? s.name : v.text(b.name, 'name', 120);
    const price = b.price === undefined ? s.price : v.integer(b.price, 'price', 1, 100000000);
    const active = b.active === undefined ? s.active : v.bool(b.active, 'active');
    const signature = b.requiresSignature === undefined ? s.requires_signature : v.bool(b.requiresSignature, 'requiresSignature');
    atomic(() => { run('UPDATE services SET name=?,price=?,active=?,requires_signature=? WHERE id=?', name, price, active, signature, serviceId); audit(req.user.id, 'servicio.actualizado', 'servicio', serviceId); });
    res.json(one('SELECT * FROM services WHERE id=?', serviceId));
  });
  app.get('/api/plantillas', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    res.json({ items: all('SELECT * FROM templates WHERE active=1 ORDER BY id LIMIT ? OFFSET ?', limit, offset) });
  });
  app.post('/api/plantillas', roles('admin'), (req, res) => {
    const b = req.body || {}, name = v.text(b.name, 'name', 120), content = v.text(b.content, 'content', 100000);
    const templateId = atomic(() => {
      const result = run('INSERT INTO templates(name,content,updated_at) VALUES(?,?,?)', name, content, now());
      const id = Number(result.lastInsertRowid); audit(req.user.id, 'plantilla.creada', 'plantilla', id); return id;
    });
    res.status(201).json(one('SELECT * FROM templates WHERE id=?', templateId));
  });
  app.patch('/api/plantillas/:id', roles('admin'), (req, res) => {
    const templateId = v.id(req.params.id), b = req.body || {}, row = one('SELECT * FROM templates WHERE id=?', templateId);
    if (!row) v.fail(404, 'NOT_FOUND', 'Plantilla no encontrada.');
    if (v.integer(b.expectedVersion, 'expectedVersion') !== row.version) v.fail(409, 'VERSION_CONFLICT', 'La plantilla cambió. Vuelve a cargarla.');
    const name = b.name === undefined ? row.name : v.text(b.name, 'name', 120);
    const content = b.content === undefined ? row.content : v.text(b.content, 'content', 100000);
    const active = b.active === undefined ? row.active : v.bool(b.active, 'active');
    atomic(() => { run('UPDATE templates SET name=?,content=?,active=?,version=version+1,updated_at=? WHERE id=?', name, content, active, now(), templateId); audit(req.user.id, 'plantilla.actualizada', 'plantilla', templateId); });
    res.json(one('SELECT * FROM templates WHERE id=?', templateId));
  });
  app.get('/api/tramites', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    const where = ['1=1'], args = [];
    if (req.user.role === 'cliente') { where.push('c.client_id=?'); args.push(req.user.id); }
    if (req.user.role === 'comercial') { where.push('c.assigned_id=?'); args.push(req.user.id); }
    if (req.query.status !== undefined) { where.push('c.status=?'); args.push(v.text(req.query.status, 'status', 40)); }
    const filter = where.join(' AND ');
    res.json({ items: all(`SELECT c.*,u.name AS client_name,a.name AS assigned_name FROM cases c JOIN users u ON u.id=c.client_id LEFT JOIN users a ON a.id=c.assigned_id WHERE ${filter} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset), total: one(`SELECT COUNT(*) AS n FROM cases c WHERE ${filter}`, ...args).n, limit, offset });
  });
  app.post('/api/tramites', roles('cliente', 'admin'), (req, res) => {
    const b = req.body || {}, serviceId = v.integer(b.serviceId, 'serviceId'), title = v.text(b.title, 'title', 160), details = v.text(b.details || '', 'details', 5000, 0);
    const clientId = req.user.role === 'cliente' ? req.user.id : v.integer(b.clientId, 'clientId');
    const service = one('SELECT * FROM services WHERE id=? AND active=1', serviceId);
    if (!service) v.fail(404, 'NOT_FOUND', 'Servicio no disponible.');
    if (!one("SELECT id FROM users WHERE id=? AND role='cliente' AND active=1", clientId)) v.fail(400, 'INVALID_CLIENT', 'Cliente no válido.');
    const caseId = atomic(() => {
      const timestamp = now();
      const result = run("INSERT INTO cases(client_id,service_id,service_name,amount,requires_signature,title,details,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pendiente_pago',?,?)", clientId, serviceId, service.name, service.price, service.requires_signature, title, details, timestamp, timestamp);
      const id = Number(result.lastInsertRowid), folio = `EO-${timestamp.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      run('UPDATE cases SET folio=? WHERE id=?', folio, id);
      audit(req.user.id, 'tramite.creado', 'tramite', id); notify(clientId, id, `Se creó el trámite ${folio}.`); return id;
    });
    res.status(201).json(one('SELECT * FROM cases WHERE id=?', caseId));
  });
  app.get('/api/tramites/:id', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req);
    audit(req.user.id, 'tramite.consulta', 'tramite', row.id);
    res.json({ ...row, documents: all('SELECT * FROM documents WHERE case_id=? ORDER BY version DESC', row.id),
      attachments: all('SELECT id,name,mime,sha256,created_at FROM attachments WHERE case_id=?', row.id) });
  });
  app.patch('/api/tramites/:id/asignacion', roles('admin'), (req, res) => {
    const row = caseFor(req, true), assignedId = v.integer(req.body?.assignedId, 'assignedId');
    if (!one("SELECT id FROM users WHERE id=? AND role='comercial' AND active=1", assignedId)) v.fail(400, 'INVALID_ASSIGNEE', 'Selecciona un ejecutivo comercial activo.');
    atomic(() => {
      run('UPDATE cases SET assigned_id=?,updated_at=? WHERE id=?', assignedId, now(), row.id);
      audit(req.user.id, 'tramite.asignacion', 'tramite', row.id, { assignedId });
      notify(assignedId, row.id, `Se te asignó el trámite ${row.folio}.`);
    });
    res.json(one('SELECT * FROM cases WHERE id=?', row.id));
  });
  app.patch('/api/tramites/:id/estado', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req, true), state = v.text(req.body?.status, 'status', 40);
    const reason = v.text(req.body?.reason || '', 'reason', 1000, 0);
    const transitions = { pendiente_pago: ['cancelado'], en_redaccion: ['en_revision'], en_revision: ['observado', 'aprobado'], observado: ['en_redaccion'], aprobado: ['completado'] };
    if (!transitions[row.status]?.includes(state)) v.fail(409, 'INVALID_TRANSITION', 'Cambio de estado no permitido.');
    if (req.user.role === 'cliente' && !['en_revision', 'en_redaccion', 'cancelado'].includes(state)) v.fail(403, 'FORBIDDEN', 'No puedes aprobar tu propio trámite.');
    if (state === 'cancelado' && one("SELECT id FROM payments WHERE case_id=? AND status IN ('pendiente','aprobado')", row.id)) v.fail(409, 'PAYMENT_EXISTS', 'Resuelve el pago pendiente antes de cancelar.');
    if (state === 'en_revision' && !one('SELECT id FROM documents WHERE case_id=?', row.id)) v.fail(409, 'DOCUMENT_REQUIRED', 'Guarda un documento antes de enviar a revisión.');
    if (state === 'observado' && !reason) v.fail(400, 'REASON_REQUIRED', 'Indica las observaciones.');
    if (state === 'completado' && row.requires_signature) v.fail(409, 'SIGNATURE_REQUIRED', 'Este trámite requiere firma electrónica verificada.');
    atomic(() => changeState(req, row, state, reason));
    res.json(one('SELECT * FROM cases WHERE id=?', row.id));
  });
  app.post('/api/tramites/:id/documentos', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req, true), b = req.body || {};
    if (!['en_redaccion', 'observado'].includes(row.status)) v.fail(409, 'DOCUMENT_LOCKED', 'Solo se puede editar en redacción o con observaciones.');
    const latest = one('SELECT COALESCE(MAX(version),0) AS version FROM documents WHERE case_id=?', row.id).version;
    if (v.integer(b.expectedVersion, 'expectedVersion', 0) !== latest) v.fail(409, 'VERSION_CONFLICT', 'Existe una versión más reciente. Vuelve a cargar el documento.');
    const content = v.text(b.content, 'content', 100000);
    const documentId = atomic(() => {
      const result = run('INSERT INTO documents(case_id,version,content,author_id,created_at) VALUES(?,?,?,?,?)', row.id, latest + 1, content, req.user.id, now());
      const id = Number(result.lastInsertRowid); audit(req.user.id, 'documento.version', 'tramite', row.id, { documentId: id, version: latest + 1 });
      run('UPDATE cases SET updated_at=? WHERE id=?', now(), row.id); return id;
    });
    res.status(201).json(one('SELECT * FROM documents WHERE id=?', documentId));
  });
  app.get('/api/tramites/:id/documentos/:documentId/descarga', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req), doc = one('SELECT * FROM documents WHERE id=? AND case_id=?', v.id(req.params.documentId), row.id);
    if (!doc) v.fail(404, 'NOT_FOUND', 'Documento no encontrado.');
    audit(req.user.id, 'documento.descarga', 'tramite', row.id, { documentId: doc.id });
    res.set('Content-Disposition', `attachment; filename="${row.folio}-borrador-v${doc.version}.txt"`);
    res.type('text/plain').send('BORRADOR SIN FIRMA ELECTRONICA\n\n' + doc.content);
  });
  app.post('/api/tramites/:id/adjuntos', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req, true), b = req.body || {};
    if (!['pendiente_pago', 'en_redaccion', 'observado'].includes(row.status)) v.fail(409, 'DOCUMENT_LOCKED', 'No puedes agregar adjuntos en este estado.');
    const name = v.text(b.name, 'name', 160).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (typeof b.base64 !== 'string' || b.base64.length > 2800000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64)) v.fail(400, 'INVALID_FILE', 'Base64 inválido o archivo demasiado grande.');
    const bytes = Buffer.from(b.base64, 'base64');
    if (bytes.length < 5 || bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') v.fail(400, 'INVALID_FILE', 'Adjunta un PDF de hasta 2 MiB.');
    if (one('SELECT COUNT(*) AS n FROM attachments WHERE case_id=?', row.id).n >= 10) v.fail(409, 'FILE_LIMIT', 'Máximo 10 adjuntos por trámite.');
    const attachmentId = atomic(() => {
      const result = run('INSERT INTO attachments(case_id,name,mime,bytes,sha256,author_id,created_at) VALUES(?,?,?,?,?,?,?)', row.id, name, 'application/pdf', bytes, digest(bytes), req.user.id, now());
      const id = Number(result.lastInsertRowid); audit(req.user.id, 'adjunto.creado', 'tramite', row.id, { attachmentId: id }); return id;
    });
    res.status(201).json({ id: attachmentId, name, sha256: digest(bytes) });
  });
  app.get('/api/tramites/:id/adjuntos/:attachmentId/descarga', roles('admin', 'comercial', 'cliente'), (req, res) => {
    const row = caseFor(req), attachment = one('SELECT * FROM attachments WHERE id=? AND case_id=?', v.id(req.params.attachmentId), row.id);
    if (!attachment) v.fail(404, 'NOT_FOUND', 'Adjunto no encontrado.');
    audit(req.user.id, 'adjunto.descarga', 'tramite', row.id, { attachmentId: attachment.id });
    res.set('Content-Disposition', `attachment; filename="${attachment.name}"`);
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.type('application/pdf').send(Buffer.from(attachment.bytes));
  });
  app.post('/api/tramites/:id/firma', roles('admin', 'comercial'), (req, res) => {
    const row = caseFor(req, true);
    if (row.status !== 'aprobado' || !row.requires_signature) v.fail(409, 'INVALID_STATE', 'Requiere un trámite aprobado con firma requerida.');
    v.fail(503, 'SIGNATURE_NOT_CONFIGURED', 'Falta integrar el proveedor de firma electrónica avanzada. No se ha firmado ni enviado el documento.');
  });
  app.post('/api/tramites/:id/webpay', roles('cliente', 'admin'), (req, res) => {
    const row = caseFor(req, true);
    if (row.status !== 'pendiente_pago') v.fail(409, 'INVALID_STATE', 'El trámite no está pendiente de pago.');
    v.fail(503, 'WEBPAY_NOT_CONFIGURED', 'Webpay no está integrado. No se ha realizado ningún cobro.');
  });
  app.post('/api/tramites/:id/pagos', roles('cliente', 'admin'), (req, res) => {
    const row = caseFor(req, true), reference = v.text(req.body?.reference, 'reference', 120);
    if (row.status !== 'pendiente_pago') v.fail(409, 'INVALID_STATE', 'El trámite no está pendiente de pago.');
    const paymentId = atomic(() => {
      if (one("SELECT id FROM payments WHERE (case_id=? AND status IN ('pendiente','aprobado')) OR reference=?", row.id, reference)) v.fail(409, 'PAYMENT_EXISTS', 'Ya existe un pago activo o esa referencia fue utilizada.');
      const result = run("INSERT INTO payments(case_id,amount,method,reference,status,submitted_by,created_at) VALUES(?,?,'transferencia',?,'pendiente',?,?)", row.id, row.amount, reference, req.user.id, now());
      const id = Number(result.lastInsertRowid); audit(req.user.id, 'pago.informado', 'pago', id);
      return id;
    });
    res.status(201).json(one('SELECT * FROM payments WHERE id=?', paymentId));
  });
  app.get('/api/pagos', roles('admin', 'finanzas', 'cliente'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    const where = req.user.role === 'cliente' ? 'WHERE c.client_id=?' : '';
    const args = req.user.role === 'cliente' ? [req.user.id] : [];
    res.json({ items: all(`SELECT p.*,c.folio,u.name AS client_name FROM payments p JOIN cases c ON c.id=p.case_id JOIN users u ON u.id=c.client_id ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset) });
  });
  app.patch('/api/pagos/:id/revision', roles('admin', 'finanzas'), (req, res) => {
    const paymentId = v.id(req.params.id), state = req.body?.status;
    if (!['aprobado', 'rechazado'].includes(state)) v.fail(400, 'VALIDATION_ERROR', 'Estado de revisión inválido.');
    const reason = v.text(req.body?.reason, 'reason', 1000);
    atomic(() => {
      const payment = one('SELECT * FROM payments WHERE id=?', paymentId);
      if (!payment) v.fail(404, 'NOT_FOUND', 'Pago no encontrado.');
      if (payment.status !== 'pendiente') v.fail(409, 'ALREADY_REVIEWED', 'El pago ya fue revisado.');
      if (payment.submitted_by === req.user.id) v.fail(403, 'SELF_APPROVAL', 'Otra persona debe revisar el pago que informaste.');
      const row = one('SELECT * FROM cases WHERE id=?', payment.case_id);
      if (row.status !== 'pendiente_pago') v.fail(409, 'INVALID_STATE', 'Trámite no pendiente de pago.');
      run('UPDATE payments SET status=?,reason=?,reviewed_by=?,reviewed_at=? WHERE id=?', state, reason, req.user.id, now(), paymentId);
      audit(req.user.id, 'pago.revisado', 'pago', paymentId, { state, reason });
      if (state === 'aprobado') changeState(req, row, 'en_redaccion');
      else notify(row.client_id, row.id, `El pago de ${row.folio} fue rechazado: ${reason}`);
    });
    res.json(one('SELECT * FROM payments WHERE id=?', paymentId));
  });
  app.get('/api/pagos/:id/comprobante', roles('admin', 'finanzas', 'cliente'), (req, res) => {
    const args = [v.id(req.params.id)];
    const extra = req.user.role === 'cliente' ? ' AND c.client_id=?' : '';
    if (extra) args.push(req.user.id);
    const payment = one(`SELECT p.*,c.folio FROM payments p JOIN cases c ON c.id=p.case_id WHERE p.id=?${extra}`, ...args);
    if (!payment) v.fail(404, 'NOT_FOUND', 'Pago no encontrado.');
    if (payment.status !== 'aprobado') v.fail(409, 'PAYMENT_NOT_APPROVED', 'El pago aún no está aprobado.');
    audit(req.user.id, 'pago.comprobante', 'pago', payment.id);
    res.set('Content-Disposition', `attachment; filename="comprobante-${payment.id}.txt"`);
    res.type('text/plain').send(`COMPROBANTE INTERNO - NO ES BOLETA NI FACTURA\nTrámite: ${payment.folio}\nMonto: ${payment.amount} CLP\nMétodo: transferencia\nReferencia: ${payment.reference}\nVerificado: ${payment.reviewed_at}\n`);
  });
  app.get('/api/reportes/finanzas', roles('admin', 'finanzas'), (req, res) => {
    const month = req.query.month || now().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) v.fail(400, 'VALIDATION_ERROR', 'month debe tener formato YYYY-MM.');
    const approved = one("SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS total,COALESCE(AVG(amount),0) AS average FROM payments WHERE status='aprobado' AND substr(reviewed_at,1,7)=?", month);
    const rejected = one("SELECT COUNT(*) AS count FROM payments WHERE status='rechazado' AND substr(reviewed_at,1,7)=?", month);
    audit(req.user.id, 'reporte.finanzas', 'reporte', null, { month });
    res.json({ month, timezone: 'UTC', currency: 'CLP', ingresos: approved.total, pagosAprobados: approved.count, pagosRechazados: rejected.count, ticketPromedio: Math.round(approved.average) });
  });
  app.get('/api/indicadores', roles('admin'), (req, res) => {
    res.json({ tramitesPorEstado: all('SELECT status,COUNT(*) AS total FROM cases GROUP BY status'),
      clientesActivos: one("SELECT COUNT(*) AS n FROM users WHERE role='cliente' AND active=1").n,
      tramitesSinAsignar: one("SELECT COUNT(*) AS n FROM cases WHERE assigned_id IS NULL AND status NOT IN ('cancelado','entregado','completado')").n,
      pagosPendientes: one("SELECT COUNT(*) AS n FROM payments WHERE status='pendiente'").n });
  });
  app.get('/api/auditoria', roles('admin'), (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    res.json({ items: all('SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset).map(row => ({ ...row, metadata: JSON.parse(row.metadata) })) });
  });
  app.get('/api/notificaciones', (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    res.json({ items: all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', req.user.id, limit, offset) });
  });
  app.patch('/api/notificaciones/:id/leida', (req, res) => {
    const notificationId = v.id(req.params.id);
    atomic(() => {
      const result = run('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?', now(), notificationId, req.user.id);
      if (!result.changes) v.fail(404, 'NOT_FOUND', 'Notificación no encontrada.');
      audit(req.user.id, 'notificacion.leida', 'notificacion', notificationId);
    });
    res.sendStatus(204);
  });
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } }));
  app.use((error, req, res, next) => {
    if (error instanceof v.ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Solicitud demasiado grande.' } });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
    if (String(error.code).startsWith('SQLITE_CONSTRAINT') || /constraint failed/i.test(error.message || '')) return res.status(409).json({ error: { code: 'CONFLICT', message: 'La operación entra en conflicto con un registro existente.' } });
    console.error('API error:', error.code || error.name);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } });
  });
  return app;
}
module.exports = { createApp };
