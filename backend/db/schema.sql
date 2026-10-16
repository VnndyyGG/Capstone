-- Tablas que usa la API de Easy Office (usuarios, trámites, pagos, auditoría).
-- El backend NO las crea: ejecuta este script tú mismo en pgAdmin o con psql
-- sobre la base indicada en DATABASE_URL. Es idempotente (IF NOT EXISTS / OR REPLACE).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, rut TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('cliente','admin','comercial','finanzas')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0 AND price <= 100000000),
  requires_signature INTEGER NOT NULL CHECK(requires_signature IN (0,1)), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY, folio TEXT UNIQUE, client_id INTEGER NOT NULL REFERENCES users(id),
  assigned_id INTEGER REFERENCES users(id), service_id INTEGER NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), requires_signature INTEGER NOT NULL,
  title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pendiente_pago','en_redaccion','en_revision','observado','aprobado','pendiente_firma','firmado','entregado','completado','cancelado')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_client ON cases(client_id);
CREATE INDEX IF NOT EXISTS cases_assigned ON cases(assigned_id);
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), version INTEGER NOT NULL,
  content TEXT NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(case_id,version)
);
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), name TEXT NOT NULL,
  mime TEXT NOT NULL, bytes BYTEA NOT NULL, sha256 TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method = 'transferencia'), reference TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pendiente','aprobado','rechazado')),
  submitted_by INTEGER NOT NULL REFERENCES users(id), reviewed_by INTEGER REFERENCES users(id),
  reason TEXT, created_at TEXT NOT NULL, reviewed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_open ON payments(case_id) WHERE status IN ('pendiente','aprobado');
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), case_id INTEGER REFERENCES cases(id),
  message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id INTEGER, metadata TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'Audit is append-only'; END $$;
CREATE OR REPLACE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE OR REPLACE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit
  FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();
