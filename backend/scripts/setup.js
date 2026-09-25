const { openDatabase, transaction } = require('../src/db');
const { hashPassword } = require('../src/security');
const v = require('../src/validation');

(async () => {
  const demo = process.argv.includes('--demo');
  if (demo && process.env.NODE_ENV === 'production') throw new Error('No se permite cargar datos demo en producción.');
  const email = v.email(process.env.ADMIN_EMAIL);
  const password = v.password(process.env.ADMIN_PASSWORD);
  if (password.startsWith('REEMPLAZAR_')) throw new Error('Reemplaza ADMIN_PASSWORD de ejemplo por una contraseña propia.');
  const hash = await hashPassword(password);
  const db = openDatabase(process.env.DB_PATH || './data/easyoffice.sqlite');
  try {
    transaction(db, () => {
      if (db.prepare("SELECT id FROM users WHERE role='admin'").get()) throw new Error('Ya existe un administrador. Este comando no modifica contraseñas existentes.');
      db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run('Administrador', email, hash, 'admin', new Date().toISOString());
      db.prepare('INSERT INTO audit(actor_id,action,entity,metadata,created_at) VALUES(?,?,?,?,?)').run(null, 'sistema.inicializacion', 'sistema', '{}', new Date().toISOString());
    });
    if (demo) {
      const rows = [['Cliente de prueba', 'cliente@example.test', 'cliente'], ['Comercial de prueba', 'comercial@example.test', 'comercial'], ['Finanzas de prueba', 'finanzas@example.test', 'finanzas']];
      // La contraseña demo es la proporcionada por el operador; no hay claves fijas en código.
      for (const [name, email, role] of rows) {
        const demoHash = await hashPassword(password);
        db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(name, email, demoHash, role, new Date().toISOString());
      }
      transaction(db, () => {
        db.prepare('INSERT INTO services(name,price,requires_signature) VALUES(?,?,?)').run('DEMO: trámite documental sin firma', 15000, 0);
        db.prepare('INSERT INTO services(name,price,requires_signature) VALUES(?,?,?)').run('DEMO: documento con firma avanzada (integración pendiente)', 22000, 1);
        db.prepare('INSERT INTO templates(name,content,updated_at) VALUES(?,?,?)').run('DEMO: estructura de documento', 'BORRADOR DE PRUEBA\nTítulo: [completar]\nContenido: [completar]\nEsta plantilla técnica requiere revisión antes de cualquier uso real.', new Date().toISOString());
      });
      console.log('Datos DEMO creados. Usuarios: cliente@example.test, comercial@example.test, finanzas@example.test. Usan la contraseña indicada en ADMIN_PASSWORD.');
    }
    console.log('Administrador creado. Configura servicios y precios reales desde la API.');
  } finally { db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
