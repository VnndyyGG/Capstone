
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta configurar DATABASE_URL en .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function testConnection() {
  const result = await query('SELECT NOW() AS fecha');
  console.log('PostgreSQL conectado:', result.rows[0].fecha);
}

module.exports = {
  pool,
  query,
  transaction,
  testConnection
};
