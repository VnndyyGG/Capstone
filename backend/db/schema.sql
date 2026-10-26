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
  id SERIAL PRIMARY KEY, slug TEXT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '', fields TEXT NOT NULL DEFAULT '[]', clauses TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
-- Migración para bases creadas antes de existir los tipos de plantilla (idempotente).
ALTER TABLE templates ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS clauses TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS templates_slug ON templates(slug);
-- Cada servicio del catálogo apunta a la plantilla con la que se redacta su documento.
ALTER TABLE services ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES templates(id);
CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY, folio TEXT UNIQUE, client_id INTEGER NOT NULL REFERENCES users(id),
  assigned_id INTEGER REFERENCES users(id), service_id INTEGER NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), requires_signature INTEGER NOT NULL,
  title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('borrador','pendiente_pago','en_redaccion','en_revision','observado','aprobado','pendiente_firma','firmado','entregado','completado','cancelado')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Migración: nuevo estado 'borrador' (el cliente completa y edita el documento ANTES de pagar). Idempotente.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_status_check CHECK(status IN ('borrador','pendiente_pago','en_redaccion','en_revision','observado','aprobado','pendiente_firma','firmado','entregado','completado','cancelado'));
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

-- ===== Carrito, cupones y Webpay (idempotente) =====
-- La transferencia deja de ser un medio de pago nuevo. Se mantiene 'transferencia' en el CHECK solo para no invalidar pagos históricos.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK(method IN ('transferencia','webpay'));

-- Cupones de monto fijo (CLP). max_uses NULL = sin límite. once_per_client = 1: cada cliente lo usa una sola vez.
CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY, code TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 10000000),
  max_uses INTEGER CHECK(max_uses IS NULL OR max_uses > 0), once_per_client INTEGER NOT NULL DEFAULT 1 CHECK(once_per_client IN (0,1)),
  expires_at TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code ON coupons(code);

-- Una orden = un intento de pago Webpay por un conjunto de trámites (el carrito).
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, buy_order TEXT UNIQUE NOT NULL, client_id INTEGER NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL CHECK(subtotal > 0), discount INTEGER NOT NULL DEFAULT 0 CHECK(discount >= 0),
  total INTEGER NOT NULL CHECK(total > 0), coupon_id INTEGER REFERENCES coupons(id), coupon_code TEXT,
  status TEXT NOT NULL CHECK(status IN ('iniciada','procesando','pagada','rechazada','anulada','expirada')),
  token TEXT UNIQUE, authorization_code TEXT, card_last4 TEXT, payment_type TEXT, installments INTEGER,
  response_code INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_client ON orders(client_id);
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id), case_id INTEGER NOT NULL REFERENCES cases(id),
  amount INTEGER NOT NULL CHECK(amount > 0), paid_amount INTEGER NOT NULL CHECK(paid_amount > 0),
  PRIMARY KEY(order_id, case_id)
);
CREATE INDEX IF NOT EXISTS order_items_case ON order_items(case_id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id);