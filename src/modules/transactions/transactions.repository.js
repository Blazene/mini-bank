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
       (type, from_account_id, to_account_id, amount, description, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)
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

module.exports = { insert, findByIdempotencyKey };
