const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');

// Sends a money request with an explicit key (or none, when key is undefined).
function send(token, action, body, key) {
  const req = request(app)
    .post(`/api/v1/transactions/${action}`)
    .set('Authorization', `Bearer ${token}`);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
}

async function setup(balance = 0, email = 'a@x.com', accountNumber = 'ACC-A') {
  const { token, user } = await registerAndLogin(email);
  const account = await createAccount(user.id, accountNumber, balance);
  return { token, user, account };
}

const balanceOf = async (id) =>
  Number((await pool.query('SELECT balance FROM accounts WHERE id = $1', [id])).rows[0].balance);

const ledger = async () =>
  (await pool.query('SELECT * FROM transactions ORDER BY created_at, id')).rows;

const KEY = 'retry-key-0001';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('the Idempotency-Key header', () => {
  test.each(['deposit', 'withdraw'])('POST /transactions/%s requires it', async (action) => {
    const { token, account } = await setup(1000);
    const res = await send(token, action, { accountId: account.id, amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test.each([
    ['empty', ''],
    ['too short', 'short'],
    ['too long', 'a'.repeat(101)],
    ['containing spaces', 'has some spaces'],
    ['containing a slash', 'abc/def/ghi/jkl'],
  ])('rejects a key that is %s and changes nothing', async (label, key) => {
    const { token, account } = await setup(1000);
    const res = await send(token, 'deposit', { accountId: account.id, amount: 100 }, key);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(await balanceOf(account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test('accepts a UUID', async () => {
    const { token, account } = await setup(0);
    const res = await send(
      token,
      'deposit',
      { accountId: account.id, amount: 100 },
      '3f2b8c1e-6a4d-4b7e-9c1a-2d5e8f0a1b3c'
    );

    expect(res.status).toBe(201);
  });
});

describe('retrying with the same key', () => {
  test('returns the original deposit and moves no money the second time', async () => {
    const { token, account } = await setup(1000);
    const body = { accountId: account.id, amount: 500, description: 'salary' };

    const first = await send(token, 'deposit', body, KEY);
    const retry = await send(token, 'deposit', body, KEY);

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.transaction).toEqual(first.body.transaction);
    expect(retry.body.account.balance).toBe(1500);

    expect(await balanceOf(account.id)).toBe(1500);
    expect(await ledger()).toHaveLength(1);
  });

  test('returns the original withdrawal and takes no money the second time', async () => {
    const { token, account } = await setup(1000);
    const body = { accountId: account.id, amount: 300 };

    const first = await send(token, 'withdraw', body, KEY);
    const retry = await send(token, 'withdraw', body, KEY);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.transaction.id).toBe(first.body.transaction.id);
    expect(await balanceOf(account.id)).toBe(700);
    expect(await ledger()).toHaveLength(1);
  });

  test('different keys are different requests', async () => {
    const { token, account } = await setup(0);
    const body = { accountId: account.id, amount: 100 };

    await send(token, 'deposit', body, 'first-key-0001');
    await send(token, 'deposit', body, 'second-key-0002');

    expect(await balanceOf(account.id)).toBe(200);
    expect(await ledger()).toHaveLength(2);
  });

  test('the same key with a different amount is refused and changes nothing', async () => {
    const { token, account } = await setup(1000);
    await send(token, 'deposit', { accountId: account.id, amount: 500 }, KEY);
    const res = await send(token, 'deposit', { accountId: account.id, amount: 600 }, KEY);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(account.id)).toBe(1500);
    expect(await ledger()).toHaveLength(1);
  });

  test('the same key for a different type of request is refused', async () => {
    const { token, account } = await setup(1000);
    await send(token, 'deposit', { accountId: account.id, amount: 500 }, KEY);
    const res = await send(token, 'withdraw', { accountId: account.id, amount: 500 }, KEY);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(account.id)).toBe(1500);
  });

  test('the same key with a different description is refused', async () => {
    const { token, account } = await setup(0);
    await send(token, 'deposit', { accountId: account.id, amount: 100, description: 'a' }, KEY);
    const res = await send(
      token,
      'deposit',
      { accountId: account.id, amount: 100, description: 'b' },
      KEY
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('a missing description and an empty one count as the same request', async () => {
    const { token, account } = await setup(0);
    await send(token, 'deposit', { accountId: account.id, amount: 100 }, KEY);
    const retry = await send(
      token,
      'deposit',
      { accountId: account.id, amount: 100, description: '' },
      KEY
    );

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await balanceOf(account.id)).toBe(100);
  });

  test('keys belong to one account, so two accounts can use the same key', async () => {
    const a = await setup(0, 'a@x.com', 'ACC-A');
    const b = await setup(0, 'b@x.com', 'ACC-B');
    const second = await createAccount(a.user.id, 'ACC-A2', 0);

    const resA = await send(a.token, 'deposit', { accountId: a.account.id, amount: 100 }, KEY);
    const resB = await send(b.token, 'deposit', { accountId: b.account.id, amount: 200 }, KEY);
    const resA2 = await send(a.token, 'deposit', { accountId: second.id, amount: 300 }, KEY);

    for (const res of [resA, resB, resA2]) {
      expect(res.status).toBe(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    }
    expect(await balanceOf(a.account.id)).toBe(100);
    expect(await balanceOf(b.account.id)).toBe(200);
    expect(await balanceOf(second.id)).toBe(300);
    expect(await ledger()).toHaveLength(3);
  });

  test('a retry still succeeds after the account is frozen', async () => {
    const { token, account } = await setup(0);
    const body = { accountId: account.id, amount: 100 };
    await send(token, 'deposit', body, KEY);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [account.id]);

    const retry = await send(token, 'deposit', body, KEY);
    const fresh = await send(token, 'deposit', body, 'brand-new-key');

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(fresh.status).toBe(409);
    expect(await balanceOf(account.id)).toBe(100);
  });

  test('a refused request is not remembered, so the same key can succeed later', async () => {
    const { token, account } = await setup(100);
    const body = { accountId: account.id, amount: 500 };

    const refused = await send(token, 'withdraw', body, KEY);
    await send(token, 'deposit', { accountId: account.id, amount: 1000 }, 'top-up-key-1');
    const later = await send(token, 'withdraw', body, KEY);

    expect(refused.status).toBe(422);
    expect(later.status).toBe(201);
    expect(later.headers['idempotent-replayed']).toBeUndefined();
    expect(await balanceOf(account.id)).toBe(600);
  });

  test('someone else cannot use your account, with or without your key', async () => {
    const a = await setup(0, 'a@x.com', 'ACC-A');
    const b = await setup(0, 'b@x.com', 'ACC-B');
    await send(a.token, 'deposit', { accountId: a.account.id, amount: 100 }, KEY);

    const res = await send(b.token, 'deposit', { accountId: a.account.id, amount: 100 }, KEY);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(a.account.id)).toBe(100);
  });
});

describe('concurrency: the same key sent many times at once', () => {
  test('10 simultaneous deposits with ONE key move the money exactly once', async () => {
    const { token, account } = await setup(1000);
    const body = { accountId: account.id, amount: 500 };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => send(token, 'deposit', body, KEY))
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.transaction.id)).size).toBe(1);
    expect(responses.filter((r) => !r.headers['idempotent-replayed'])).toHaveLength(1);
    expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);

    expect(await balanceOf(account.id)).toBe(1500);
    expect(await ledger()).toHaveLength(1);
  });

  test('10 simultaneous withdrawals with ONE key take the money exactly once', async () => {
    const { token, account } = await setup(100);
    const body = { accountId: account.id, amount: 30 };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => send(token, 'withdraw', body, KEY))
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(account.id)).toBe(70);
    expect(await ledger()).toHaveLength(1);
  });

  test('a retry storm: 5 different requests, each sent 4 times at once', async () => {
    const { token, account } = await setup(0);

    const requests = [];
    for (let n = 1; n <= 5; n += 1) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        requests.push(
          send(token, 'deposit', { accountId: account.id, amount: n * 100 }, `storm-key-${n}`)
        );
      }
    }
    const responses = await Promise.all(requests);

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(account.id)).toBe(100 + 200 + 300 + 400 + 500);
    expect(await ledger()).toHaveLength(5);
  });
});
