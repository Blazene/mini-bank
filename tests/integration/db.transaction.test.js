const { withTransaction } = require('../../src/config/db');
const { pool, resetDb, createUser, createAccount } = require('../helpers/db');

const balanceOf = async (id) =>
  Number((await pool.query('SELECT balance FROM accounts WHERE id = $1', [id])).rows[0].balance);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('commits everything when the function finishes', async () => {
  const user = await createUser();
  const account = await createAccount(user.id, 'ACC1', 100);

  await withTransaction(async (client) => {
    await client.query('UPDATE accounts SET balance = balance + 50 WHERE id = $1', [account.id]);
  });

  expect(await balanceOf(account.id)).toBe(150);
});

test('rolls back every change and rethrows when the function fails', async () => {
  const user = await createUser();
  const account = await createAccount(user.id, 'ACC1', 100);

  await expect(
    withTransaction(async (client) => {
      await client.query('UPDATE accounts SET balance = balance - 40 WHERE id = $1', [account.id]);
      throw new Error('something broke half way');
    })
  ).rejects.toThrow('something broke half way');

  expect(await balanceOf(account.id)).toBe(100);
});

test('rolls back earlier statements when a later one violates a constraint', async () => {
  const user = await createUser();
  const account = await createAccount(user.id, 'ACC1', 100);

  await expect(
    withTransaction(async (client) => {
      await client.query('UPDATE accounts SET balance = balance + 25 WHERE id = $1', [account.id]);
      await client.query('UPDATE accounts SET balance = balance - 999 WHERE id = $1', [account.id]);
    })
  ).rejects.toMatchObject({ code: '23514' });

  expect(await balanceOf(account.id)).toBe(100);
});

test('gives the connection back to the pool after success and after failure', async () => {
  await withTransaction(async () => {});
  await withTransaction(async () => {
    throw new Error('fail');
  }).catch(() => {});

  expect(pool.idleCount).toBe(pool.totalCount);
});
