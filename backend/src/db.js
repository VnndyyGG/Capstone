const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

// COUNT/SUM devuelven BIGINT y AVG NUMERIC; pg los entrega como string por defecto.
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

// Las consultas usan "?" como en SQLite; se traducen a $1, $2... para pg.
const toPg = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };

async function openDatabase(connectionString = process.env.DATABASE_URL) {
  // Sin DATABASE_URL, pg usa PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD.
  const pool = new Pool(connectionString ? { connectionString } : {});
  pool.on('error', error => console.error('PostgreSQL error:', error.code || error.message));
  const tx = new AsyncLocalStorage();
  const query = (sql, args) => (tx.getStore() || pool).query(toPg(sql), args);
  const db = {
    run: async (sql, ...args) => ({ changes: (await query(sql, args)).rowCount }),
    insert: async (sql, ...args) => (await query(sql + ' RETURNING id', args)).rows[0].id,
    one: async (sql, ...args) => (await query(sql, args)).rows[0],
    all: async (sql, ...args) => (await query(sql, args)).rows,
    close: () => pool.end(),
    pool
  };
  db.transaction = async fn => {
    if (tx.getStore()) return fn();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await tx.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  };
  try {
    // Solo verifica la conexión: el esquema lo administra el equipo con db/schema.sql.
    await pool.query('SELECT 1');
  } catch (error) { await pool.end(); throw error; }
  return db;
}
const transaction = (db, fn) => db.transaction(fn);
module.exports = { openDatabase, transaction };
