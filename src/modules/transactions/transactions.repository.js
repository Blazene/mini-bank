const { paiseToNumber } = require('../../shared/utils/money');

const COLUMNS = 'id, type, from_account_id, to_account_id, amount, status, description, created_at';

const toTransaction = (row) => ({
  id: row.id,
  type: row.type,
  fromAccountId: row.from_account_id,
  toAccountId: row.to_account_id,
  amount: paiseToNumber(row.amount),
  status: row.status,
  description: row.description,
  createdAt: row.created_at,
});

// Takes the client of an open transaction, so the ledger row is saved or rolled back together
// with the balance change.
async function insert(
  client,
  { type, fromAccountId, toAccountId, amount, description, idempotencyKey }
) {
  const { rows } = await client.query(
    `INSERT INTO transactions
       (type, from_account_id, to_account_id, amount, description, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())
     RETURNING ${COLUMNS}`,
    [type, fromAccountId, toAccountId, amount, description || null, idempotencyKey]
  );
  return toTransaction(rows[0]);
}

// Has this account already used this key? The expression matches the unique index in the
// schema, COALESCE(from_account_id, to_account_id), which is "the account the request came in on":
// the source for a withdrawal or transfer, the destination for a deposit.
async function findByIdempotencyKey(client, accountId, idempotencyKey) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}
     FROM transactions
     WHERE COALESCE(from_account_id, to_account_id) = $1
       AND idempotency_key = $2`,
    [accountId, idempotencyKey]
  );
  return rows.length === 0 ? null : toTransaction(rows[0]);
}

// Current transfer counts as one, regardless of how long its transaction waited on locks.
// Count at most four OTHER completed outgoing transfers in the inclusive five-minute
// window ending at this statement. The existing source-account index bounds the scan.
async function countRecentOutgoingTransfers(client, accountId, currentId) {
  const { rows } = await client.query(
    `SELECT count(*)::int + 1 AS count FROM (
       SELECT 1 FROM transactions
       WHERE from_account_id = $1 AND id <> $2 AND type = 'transfer' AND status = 'completed'
         AND created_at >= statement_timestamp() - INTERVAL '5 minutes'
         AND created_at <= statement_timestamp()
       LIMIT 4
     ) recent`,
    [accountId, currentId]
  );
  return rows[0].count;
}

module.exports = {
  insert,
  findByIdempotencyKey,
  countRecentOutgoingTransfers,
  COLUMNS,
  toTransaction,
};
