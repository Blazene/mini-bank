const env = require('../../src/config/env');
const { pool } = require('../../src/config/db');

// Safety guard: never wipe a database that is not clearly a test database
function assertTestDatabase() {
  const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": database name must end with _test`);
  }
}

async function resetDb() {
  assertTestDatabase();
  await pool.query('TRUNCATE users CASCADE'); // also clears accounts and transactions
}

async function createUser(email = 'a@x.com') {
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash)
     VALUES ($1, 'Test User', 'not-a-real-hash') RETURNING *`,
    [email]
  );
  return rows[0];
}

async function createAccount(userId, accountNumber = 'ACC1', balance = 0) {
  const { rows } = await pool.query(
    `INSERT INTO accounts (user_id, account_number, type, balance)
     VALUES ($1, $2, 'savings', $3) RETURNING *`,
    [userId, accountNumber, balance]
  );
  return rows[0];
}

module.exports = { pool, resetDb, createUser, createAccount };
