const db = require('../../config/db');

const toEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  action: row.action,
  outcome: row.outcome,
  statusCode: row.status_code,
  ipAddress: row.ip_address,
  metadata: row.metadata,
  createdAt: row.created_at,
});

async function insert({ userId, action, outcome, statusCode, ipAddress, metadata }) {
  const { rows } = await db.query(
    `INSERT INTO audit_logs (user_id, action, outcome, status_code, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, action, outcome, statusCode, ipAddress, JSON.stringify(metadata)]
  );
  return rows[0].id;
}

// One page of the log, newest first. Same keyset technique as the transaction history:
// ORDER BY created_at DESC, id DESC, and the cursor is "strictly after this row".
// Every value is a parameter. Only fixed SQL text is concatenated.
async function findPage({ action, outcome, userId, from, to, cursor, limit }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = ['TRUE'];
  if (action) where.push(`action = ${param(action)}`);
  if (outcome) where.push(`outcome = ${param(outcome)}`);
  if (userId) where.push(`user_id = ${param(userId)}`);
  if (from) where.push(`created_at >= ${param(from)}`);
  if (to) where.push(`created_at < ${param(to)}`);
  if (cursor) {
    where.push(
      `(created_at, id) < (${param(cursor.createdAt)}::timestamptz, ${param(cursor.id)}::uuid)`
    );
  }

  const { rows } = await db.query(
    `SELECT id, user_id, action, outcome, status_code, ip_address, metadata, created_at,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
     FROM audit_logs
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT ${param(limit)}`,
    params
  );
  return rows.map((row) => ({ ...toEntry(row), cursorTs: row.cursor_ts }));
}

module.exports = { insert, findPage };
