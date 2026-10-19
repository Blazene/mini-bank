const { paiseToNumber } = require('../../shared/utils/money');

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
async function insert(client, { type, fromAccountId, toAccountId, amount, description }) {
  const { rows } = await client.query(
    `INSERT INTO transactions (type, from_account_id, to_account_id, amount, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, type, from_account_id, to_account_id, amount, status, description, created_at`,
    [type, fromAccountId, toAccountId, amount, description || null]
  );
  return toTransaction(rows[0]);
}

module.exports = { insert };
