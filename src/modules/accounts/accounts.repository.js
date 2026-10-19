const db = require('../../config/db');

// pg returns BIGINT as a string, because JavaScript numbers are only exact up to 2^53 - 1.
// Balances are whole paise, so the conversion is exact for any balance below that limit
// (about 90 trillion rupees). Above it we refuse to answer rather than return a wrong number.
function paiseToNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Balance ${value} cannot be represented exactly as a JavaScript number`);
  }
  return number;
}

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

module.exports = { createAccount, findAllByUser, findByIdForUser };
