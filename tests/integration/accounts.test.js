const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createAccount } = require('../helpers/db');

async function registerAndLogin(email) {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, fullName: 'Test User', password: 'secret123' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'secret123' });
  return res.body;
}

const as = (token, method, path) =>
  request(app)[method](`/api/v1/accounts${path}`).set('Authorization', `Bearer ${token}`);

const countAccounts = async () =>
  Number((await pool.query('SELECT count(*) FROM accounts')).rows[0].count);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('POST /accounts', () => {
  test('creates a savings account with zero balance for the logged-in user', async () => {
    const { token, user } = await registerAndLogin('a@x.com');
    const res = await as(token, 'post', '').send({ type: 'savings' });

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({
      type: 'savings',
      balance: 0,
      currency: 'INR',
      status: 'active',
    });
    expect(res.body.account.accountNumber).toMatch(/^[1-9]\d{11}$/);
    expect(res.body.account.userId).toBeUndefined();

    const { rows } = await pool.query('SELECT user_id FROM accounts WHERE id = $1', [
      res.body.account.id,
    ]);
    expect(rows[0].user_id).toBe(user.id);
  });

  test('ignores balance, status and owner sent by the client', async () => {
    const { token, user } = await registerAndLogin('a@x.com');
    const other = await registerAndLogin('b@x.com');
    const res = await as(token, 'post', '').send({
      type: 'current',
      balance: 999999,
      status: 'closed',
      userId: other.user.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.account.balance).toBe(0);
    expect(res.body.account.status).toBe('active');

    const { rows } = await pool.query('SELECT user_id FROM accounts WHERE id = $1', [
      res.body.account.id,
    ]);
    expect(rows[0].user_id).toBe(user.id);
  });

  test('rejects an invalid account type and saves nothing', async () => {
    const { token } = await registerAndLogin('a@x.com');
    const res = await as(token, 'post', '').send({ type: 'premium' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('type');
    expect(await countAccounts()).toBe(0);
  });
});

describe('authentication', () => {
  test.each([
    ['post', ''],
    ['get', ''],
    ['get', '/11111111-1111-4111-8111-111111111111'],
  ])('%s /accounts%s needs a token', async (method, path) => {
    const res = await request(app)[method](`/api/v1/accounts${path}`).send({ type: 'savings' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    expect(await countAccounts()).toBe(0);
  });
});

describe('GET /accounts', () => {
  test('returns only the logged-in user accounts, newest first', async () => {
    const a = await registerAndLogin('a@x.com');
    const b = await registerAndLogin('b@x.com');
    const first = (await as(a.token, 'post', '').send({ type: 'savings' })).body.account;
    const second = (await as(a.token, 'post', '').send({ type: 'current' })).body.account;
    await as(b.token, 'post', '').send({ type: 'savings' });

    const res = await as(a.token, 'get', '');

    expect(res.status).toBe(200);
    expect(res.body.accounts.map((acc) => acc.id)).toEqual([second.id, first.id]);
  });

  test('returns an empty list when the user has no accounts', async () => {
    const { token } = await registerAndLogin('a@x.com');
    const res = await as(token, 'get', '');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [] });
  });
});

describe('GET /accounts/:id', () => {
  test('returns the account with its balance as a number of paise', async () => {
    const { token, user } = await registerAndLogin('a@x.com');
    const row = await createAccount(user.id, 'ACC-RICH', 150050);
    const res = await as(token, 'get', `/${row.id}`);

    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(row.id);
    expect(res.body.account.balance).toBe(150050);
    expect(typeof res.body.account.balance).toBe('number');
  });

  test('answers 404 for someone else account, the same as for an id that does not exist', async () => {
    const a = await registerAndLogin('a@x.com');
    const b = await registerAndLogin('b@x.com');
    const bAccount = (await as(b.token, 'post', '').send({ type: 'savings' })).body.account;

    const forbidden = await as(a.token, 'get', `/${bAccount.id}`);
    const missing = await as(a.token, 'get', '/33333333-3333-4333-8333-333333333333');

    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(forbidden.body).toEqual(missing.body);
    expect(JSON.stringify(forbidden.body)).not.toContain(bAccount.accountNumber);
  });

  test('rejects an id that is not a UUID with a 400', async () => {
    const { token } = await registerAndLogin('a@x.com');
    const res = await as(token, 'get', '/123');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('refuses to return a balance a JavaScript number cannot hold exactly', async () => {
    const { token, user } = await registerAndLogin('a@x.com');
    const row = await createAccount(user.id, 'ACC-HUGE', '9007199254740993');
    const res = await as(token, 'get', `/${row.id}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('9007199254740993');
  });
});
