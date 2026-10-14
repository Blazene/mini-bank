const { pool, resetDb, createUser, createAccount } = require('../helpers/db');

// PostgreSQL error codes
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code });

const insertTransaction = (type, from, to, amount, key = null) =>
  pool.query(
    `INSERT INTO transactions (type, from_account_id, to_account_id, amount, idempotency_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [type, from, to, amount, key]
  );

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('users', () => {
  test('accepts a valid user', async () => {
    const user = await createUser('a@x.com');
    expect(user.role).toBe('user');
  });

  test('rejects the same email in a different case', async () => {
    await createUser('a@x.com');
    await rejectsWith(createUser('A@X.com'), UNIQUE_VIOLATION);
  });

  test('rejects an invalid role', async () => {
    await rejectsWith(
      pool.query(
        `INSERT INTO users (email, full_name, password_hash, role)
         VALUES ('b@x.com', 'B', 'h', 'superuser')`
      ),
      CHECK_VIOLATION
    );
  });
});

describe('accounts', () => {
  test('rejects a negative balance', async () => {
    const user = await createUser();
    await rejectsWith(createAccount(user.id, 'ACC1', -5), CHECK_VIOLATION);
  });

  test('rejects an account for a user that does not exist', async () => {
    await rejectsWith(
      pool.query(
        `INSERT INTO accounts (user_id, account_number, type)
         VALUES (gen_random_uuid(), 'ACC2', 'savings')`
      ),
      FOREIGN_KEY_VIOLATION
    );
  });

  test('rejects a duplicate account number', async () => {
    const user = await createUser();
    await createAccount(user.id, 'ACC1');
    await rejectsWith(createAccount(user.id, 'ACC1'), UNIQUE_VIOLATION);
  });

  test('rejects an invalid account type', async () => {
    const user = await createUser();
    await rejectsWith(
      pool.query(
        `INSERT INTO accounts (user_id, account_number, type) VALUES ($1, 'ACC3', 'gold')`,
        [user.id]
      ),
      CHECK_VIOLATION
    );
  });

  test('does not allow deleting a user who still has accounts', async () => {
    const user = await createUser();
    await createAccount(user.id);
    await rejectsWith(pool.query('DELETE FROM users WHERE id = $1', [user.id]), FOREIGN_KEY_VIOLATION);
  });
});

describe('transactions', () => {
  let a;
  let b;

  beforeEach(async () => {
    const user = await createUser();
    a = await createAccount(user.id, 'ACC1', 1000);
    b = await createAccount(user.id, 'ACC2', 0);
  });

  test('accepts a valid deposit, withdrawal and transfer', async () => {
    await insertTransaction('deposit', null, a.id, 500);
    await insertTransaction('withdrawal', a.id, null, 200);
    await insertTransaction('transfer', a.id, b.id, 100);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions');
    expect(rows[0].n).toBe(3);
  });

  test('rejects a zero amount', async () => {
    await rejectsWith(insertTransaction('deposit', null, a.id, 0), CHECK_VIOLATION);
  });

  test('rejects a negative amount', async () => {
    await rejectsWith(insertTransaction('deposit', null, a.id, -100), CHECK_VIOLATION);
  });

  test('rejects a deposit that has a source account', async () => {
    await rejectsWith(insertTransaction('deposit', a.id, a.id, 100), CHECK_VIOLATION);
  });

  test('rejects a withdrawal that has a destination account', async () => {
    await rejectsWith(insertTransaction('withdrawal', a.id, b.id, 100), CHECK_VIOLATION);
  });

  test('rejects a transfer from an account to itself', async () => {
    await rejectsWith(insertTransaction('transfer', a.id, a.id, 100), CHECK_VIOLATION);
  });

  test('rejects a transfer missing its destination', async () => {
    await rejectsWith(insertTransaction('transfer', a.id, null, 100), CHECK_VIOLATION);
  });

  test('rejects the same idempotency key twice from the same account', async () => {
    await insertTransaction('transfer', a.id, b.id, 100, 'key-1');
    await rejectsWith(insertTransaction('transfer', a.id, b.id, 100, 'key-1'), UNIQUE_VIOLATION);
  });

  test('allows the same idempotency key from a different account', async () => {
    await insertTransaction('transfer', a.id, b.id, 100, 'key-1');
    await insertTransaction('transfer', b.id, a.id, 100, 'key-1');
  });
});
