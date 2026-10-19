const db = require('../../config/db');
const { paiseToNumber } = require('../../shared/utils/money');

// Convert a database row (snake_case) into the object the app uses (camelCase).
// user_id is left out on purpose: callers only ever see their own accounts.
const toAccount = (row) => ({
  id: row.id,
  accountNumber: row.account_number,
  type: row.type,
  balance: paiseToNumber(row.balance),
  currency: row.currency,
  status: row.status,
  createdAt: row.created_at,
});

const COLUMNS = 'id, account_number, type, balance, currency, status, created_at';

async function createAccount({ userId, accountNumber, type }) {
  const { rows } = await db.query(
    `INSERT INTO accounts (user_id, account_number, type)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [userId, accountNumber, type]
  );
  return toAccount(rows[0]);
}

async function findAllByUser(userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM accounts
     WHERE user_id = $1
     ORDER BY created_at DESC, id`,
    [userId]
  );
  return rows.map(toAccount);
}

// Ownership is enforced in the query itself: someone else's account simply returns no row,
// exactly like an account that does not exist.
async function findByIdForUser(accountId, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM accounts
     WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );
  return rows.length === 0 ? null : toAccount(rows[0]);
}

// The two functions below take the client of an OPEN transaction (see db.withTransaction),
// because they must run on the same connection as the rest of the money movement.

// SELECT ... FOR UPDATE locks the row until the transaction ends. Anyone else who wants to
// change this balance waits here, so two requests can never both act on the same old balance.
async function lockByIdForUser(client, accountId, userId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}
     FROM accounts
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [accountId, userId]
  );
  return rows.length === 0 ? null : toAccount(rows[0]);
}

// Relative update (balance + delta), not "set balance to this number". Negative delta = debit.
// The CHECK (balance >= 0) in the database is the last line of defence if a rule is ever missed.
async function adjustBalance(client, accountId, deltaPaise) {
  const { rows } = await client.query(
    `UPDATE accounts
     SET balance = balance + $2
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [accountId, deltaPaise]
  );
  return toAccount(rows[0]);
}

module.exports = {
  createAccount,
  findAllByUser,
  findByIdForUser,
  lockByIdForUser,
  adjustBalance,
};
