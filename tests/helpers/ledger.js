const { pool } = require('./db');

// Writes one ledger row directly, bypassing the API, so a test can choose the exact id and
// created_at (down to the microsecond). createdAt is passed as TEXT so no precision is lost.
async function insertTransaction({
  id = null,
  type = 'deposit',
  from = null,
  to = null,
  amount = 100,
  createdAt = '2026-10-01T00:00:00.000000Z',
  description = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO transactions (id, type, from_account_id, to_account_id, amount, description, created_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::timestamptz)
     RETURNING id`,
    [id, type, from, to, amount, description, createdAt]
  );
  return rows[0].id;
}

// A timestamp n seconds after 1 Oct 2026 00:00:00 UTC, with an explicit microsecond part.
function at(seconds, micros = 0) {
  const base = new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
  return base.replace('.000Z', `.${String(micros).padStart(6, '0')}Z`);
}

module.exports = { insertTransaction, at };
