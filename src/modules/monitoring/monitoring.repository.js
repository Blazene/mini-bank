const db = require('../../config/db');

const COLUMNS = 'id, transaction_id, account_id, rule_code, severity, details, created_at';
const present = (row) => ({
  id: row.id,
  transactionId: row.transaction_id,
  accountId: row.account_id,
  ruleCode: row.rule_code,
  severity: row.severity,
  details: row.details,
  createdAt: row.created_at,
});

async function insert(client, transaction, alert) {
  await client.query(
    `INSERT INTO monitoring_alerts (transaction_id, account_id, rule_code, severity, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (transaction_id, rule_code) DO NOTHING`,
    [
      transaction.id,
      transaction.fromAccountId || transaction.toAccountId,
      alert.ruleCode,
      alert.severity,
      JSON.stringify(alert.details),
    ]
  );
}

async function findPage({ ruleCode, severity, accountId, transactionId, from, to, cursor, limit }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ['TRUE'];
  if (ruleCode) where.push(`rule_code = ${param(ruleCode)}`);
  if (severity) where.push(`severity = ${param(severity)}`);
  if (accountId) where.push(`account_id = ${param(accountId)}`);
  if (transactionId) where.push(`transaction_id = ${param(transactionId)}`);
  if (from) where.push(`created_at >= ${param(from)}`);
  if (to) where.push(`created_at < ${param(to)}`);
  if (cursor)
    where.push(
      `(created_at, id) < (${param(cursor.createdAt)}::timestamptz, ${param(cursor.id)}::uuid)`
    );
  const { rows } = await db.query(
    `SELECT ${COLUMNS},
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
     FROM monitoring_alerts WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT ${param(limit)}`,
    params
  );
  return rows.map((row) => ({ ...present(row), cursorTs: row.cursor_ts }));
}

async function findById(id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM monitoring_alerts WHERE id = $1`, [id]);
  return rows.length ? present(rows[0]) : null;
}

module.exports = { insert, findPage, findById };
