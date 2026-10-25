const { Pool } = require('pg');
const env = require('./env');
const logger = require('../shared/utils/logger');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
});

// Serverless PostgreSQL can close idle connections during suspension/maintenance.
// pg removes that client; log the event instead of crashing on an unhandled emitter error.
pool.on('error', (err) => logger.error({ err }, 'Idle PostgreSQL client error'));

// Runs fn(client) inside ONE database transaction on ONE connection.
// If fn finishes, everything it did is committed together. If it throws, everything is
// rolled back and the error is passed on, so a half-finished money movement cannot be saved.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // If the rollback itself fails, the original error is the one worth reporting.
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  withTransaction,
};
