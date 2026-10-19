const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');

const post = (token, path, body) =>
  request(app)
    .post(`/api/v1/transactions${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

async function setup(balance = 0, email = 'a@x.com', accountNumber = 'ACC-A') {
  const { token, user } = await registerAndLogin(email);
  const account = await createAccount(user.id, accountNumber, balance);
  return { token, user, account };
}

const balanceOf = async (id) =>
  Number((await pool.query('SELECT balance FROM accounts WHERE id = $1', [id])).rows[0].balance);

const ledger = async () =>
  (await pool.query('SELECT * FROM transactions ORDER BY created_at, id')).rows;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('POST /transactions/deposit', () => {
  test('adds the amount to the balance and records a deposit', async () => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/deposit', {
      accountId: account.id,
      amount: 2500,
      description: 'salary',
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({
      type: 'deposit',
      amount: 2500,
      fromAccountId: null,
      toAccountId: account.id,
      status: 'completed',
      description: 'salary',
    });
    expect(res.body.account.balance).toBe(3500);
    expect(await balanceOf(account.id)).toBe(3500);

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('deposit');
    expect(rows[0].to_account_id).toBe(account.id);
    expect(rows[0].from_account_id).toBeNull();
  });

  test('adds up across several deposits', async () => {
    const { token, account } = await setup(0);
    await post(token, '/deposit', { accountId: account.id, amount: 100 });
    await post(token, '/deposit', { accountId: account.id, amount: 250 });

    expect(await balanceOf(account.id)).toBe(350);
    expect(await ledger()).toHaveLength(2);
  });

  test('cannot deposit into someone else account', async () => {
    const a = await setup(0, 'a@x.com', 'ACC-A');
    const b = await setup(500, 'b@x.com', 'ACC-B');
    const res = await post(a.token, '/deposit', { accountId: b.account.id, amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(b.account.id)).toBe(500);
    expect(await ledger()).toHaveLength(0);
  });

  test.each(['frozen', 'closed'])('refuses a %s account and changes nothing', async (status) => {
    const { token, account } = await setup(1000);
    await pool.query('UPDATE accounts SET status = $1 WHERE id = $2', [status, account.id]);
    const res = await post(token, '/deposit', { accountId: account.id, amount: 100 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test.each([
    ['zero', 0],
    ['negative', -5],
    ['a decimal', 10.5],
    ['a string', '100'],
    ['above the cap', 1000000001],
    ['null', null],
    ['missing', undefined],
  ])('rejects an amount that is %s and changes nothing', async (label, amount) => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/deposit', { accountId: account.id, amount });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test('rejects a deposit that would push the balance past what a number can hold', async () => {
    const { token, account } = await setup(9007199254740000);
    const res = await post(token, '/deposit', { accountId: account.id, amount: 1000 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect(await balanceOf(account.id)).toBe(9007199254740000);
    expect(await ledger()).toHaveLength(0);
  });
});

describe('POST /transactions/withdraw', () => {
  test('subtracts the amount and records a withdrawal from the account', async () => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/withdraw', { accountId: account.id, amount: 300 });

    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({
      type: 'withdrawal',
      amount: 300,
      fromAccountId: account.id,
      toAccountId: null,
    });
    expect(res.body.account.balance).toBe(700);
    expect(await balanceOf(account.id)).toBe(700);

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].from_account_id).toBe(account.id);
    expect(rows[0].to_account_id).toBeNull();
  });

  test('refuses to overdraw: 422, balance unchanged, nothing recorded', async () => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/withdraw', { accountId: account.id, amount: 1001 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test('allows withdrawing exactly the whole balance', async () => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/withdraw', { accountId: account.id, amount: 1000 });

    expect(res.status).toBe(201);
    expect(await balanceOf(account.id)).toBe(0);
  });

  test('cannot withdraw from someone else account', async () => {
    const a = await setup(0, 'a@x.com', 'ACC-A');
    const b = await setup(500, 'b@x.com', 'ACC-B');
    const res = await post(a.token, '/withdraw', { accountId: b.account.id, amount: 100 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(b.account.id)).toBe(500);
    expect(await ledger()).toHaveLength(0);
  });

  test('refuses a frozen account and changes nothing', async () => {
    const { token, account } = await setup(1000);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [account.id]);
    const res = await post(token, '/withdraw', { accountId: account.id, amount: 100 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    expect(await balanceOf(account.id)).toBe(1000);
  });

  test('rejects a zero amount', async () => {
    const { token, account } = await setup(1000);
    const res = await post(token, '/withdraw', { accountId: account.id, amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('authentication', () => {
  test.each(['deposit', 'withdraw'])('POST /transactions/%s needs a token', async (action) => {
    const { account } = await setup(1000);
    const res = await request(app)
      .post(`/api/v1/transactions/${action}`)
      .send({ accountId: account.id, amount: 100 });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });
});

describe('concurrency: many requests at the same moment', () => {
  test('10 simultaneous withdrawals of 30 from a balance of 100: exactly 3 succeed', async () => {
    const { token, account } = await setup(100);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        post(token, '/withdraw', { accountId: account.id, amount: 30 })
      )
    );

    const succeeded = responses.filter((r) => r.status === 201);
    const refused = responses.filter((r) => r.status === 422);
    expect(succeeded).toHaveLength(3);
    expect(refused).toHaveLength(7);
    expect(refused.every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);

    expect(await balanceOf(account.id)).toBe(10);
    expect(await ledger()).toHaveLength(3);
  });

  test('20 simultaneous deposits of 50 are all counted, none lost', async () => {
    const { token, account } = await setup(0);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(token, '/deposit', { accountId: account.id, amount: 50 })
      )
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(20);
  });

  test('mixed deposits and withdrawals: the balance always equals what the ledger says', async () => {
    const { token, account } = await setup(1000);

    const requests = [
      ...Array.from({ length: 10 }, () =>
        post(token, '/deposit', { accountId: account.id, amount: 100 })
      ),
      ...Array.from({ length: 10 }, () =>
        post(token, '/withdraw', { accountId: account.id, amount: 150 })
      ),
    ];
    const responses = await Promise.all(requests);

    expect(responses.every((r) => r.status === 201 || r.status === 422)).toBe(true);

    const rows = await ledger();
    expect(rows).toHaveLength(responses.filter((r) => r.status === 201).length);

    const deposited = rows
      .filter((r) => r.type === 'deposit')
      .reduce((n, r) => n + Number(r.amount), 0);
    const withdrawn = rows
      .filter((r) => r.type === 'withdrawal')
      .reduce((n, r) => n + Number(r.amount), 0);

    expect(await balanceOf(account.id)).toBe(1000 + deposited - withdrawn);
    expect(await balanceOf(account.id)).toBeGreaterThanOrEqual(0);
  });
});
