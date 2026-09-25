const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, rut TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('cliente','admin','comercial','finanzas')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0 AND price <= 100000000),
      requires_signature INTEGER NOT NULL CHECK(requires_signature IN (0,1)), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY, folio TEXT UNIQUE, client_id INTEGER NOT NULL REFERENCES users(id),
      assigned_id INTEGER REFERENCES users(id), service_id INTEGER NOT NULL REFERENCES services(id),
      service_name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), requires_signature INTEGER NOT NULL,
      title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pendiente_pago','en_redaccion','en_revision','observado','aprobado','pendiente_firma','firmado','entregado','completado','cancelado')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cases_client ON cases(client_id);
    CREATE INDEX IF NOT EXISTS cases_assigned ON cases(assigned_id);
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), version INTEGER NOT NULL,
      content TEXT NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      UNIQUE(case_id,version)
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), name TEXT NOT NULL,
      mime TEXT NOT NULL, bytes BLOB NOT NULL, sha256 TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), amount INTEGER NOT NULL,
      method TEXT NOT NULL CHECK(method = 'transferencia'), reference TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pendiente','aprobado','rechazado')),
      submitted_by INTEGER NOT NULL REFERENCES users(id), reviewed_by INTEGER REFERENCES users(id),
      reason TEXT, created_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payments_open ON payments(case_id) WHERE status IN ('pendiente','aprobado');
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), case_id INTEGER REFERENCES cases(id),
      message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id INTEGER, metadata TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    PRAGMA user_version = 1;
  `);
  return db;
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { openDatabase, transaction };
