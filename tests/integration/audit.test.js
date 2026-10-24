const request = require('supertest');
const app = require('../../src/app');
const env = require('../../src/config/env');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');
const { resetRateLimits } = require('../../src/shared/middleware/rateLimit');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');
const auditRepository = require('../../src/modules/audit/audit.repository');

// Waits for every pending audit write, then reads the log oldest first.
async function logRows(where = 'TRUE', params = []) {
  await flushAuditWrites();
  const { rows } = await pool.query(
    `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at, id`,
    params
  );
  return rows;
}

const register = (email, extra = {}) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({ email, fullName: 'Test Person', password: 'secret123', ...extra });

const login = (email, password = 'secret123') =>
  request(app).post('/api/v1/auth/login').send({ email, password });

let keyCounter = 0;
const post = (token, path, body, key = `audit-key-${(keyCounter += 1)}`) => {
  const req = request(app)
    .post(`/api/v1/transactions/${path}`)
    .set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

async function funded(n, balance = 100000) {
  const { token, user } = await registerAndLogin(`person${n}@x.com`);
  const account = await createAccount(user.id, String(100000000000 + n), balance);
  return { token, user, account };
}

// Setting people up creates audit rows of its own. Start each scenario from an empty log.
async function clearLog() {
  await flushAuditWrites();
  await pool.query('TRUNCATE audit_logs');
}

beforeEach(async () => {
  env.RATE_LIMIT_ENABLED = false;
  resetRateLimits();
  await resetDb();
});

afterEach(() => {
  env.RATE_LIMIT_ENABLED = false;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('register and login', () => {
  test('a sign-up is logged with the new user, the email and the client address', async () => {
    const res = await register('New@X.com');
    expect(res.status).toBe(201);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'auth.register',
      outcome: 'success',
      status_code: 201,
      user_id: res.body.user.id,
      metadata: { email: 'new@x.com' },
    });
    expect(row.ip_address).toBeTruthy();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  test('a sign-up with an email already in use is logged as a failure, with no user', async () => {
    await register('taken@x.com');
    await clearLog();

    const res = await register('taken@x.com');
    expect(res.status).toBe(409);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'auth.register',
      outcome: 'failure',
      status_code: 409,
      user_id: null,
      metadata: { email: 'taken@x.com' },
    });
  });

  test('a sign-up that fails validation is logged too', async () => {
    const res = await register('not-an-email');
    expect(res.status).toBe(400);

    const [row] = await logRows();
    expect(row).toMatchObject({ action: 'auth.register', outcome: 'failure', status_code: 400 });
  });

  test('a successful login is logged with the user', async () => {
    const { user } = await registerAndLogin('a@x.com');
    await clearLog();

    const res = await login('a@x.com');
    expect(res.status).toBe(200);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'auth.login',
      outcome: 'success',
      status_code: 200,
      user_id: user.id,
      metadata: { email: 'a@x.com' },
    });
  });

  test('a wrong password is logged as a failure with the email that was tried', async () => {
    await registerAndLogin('a@x.com');
    await clearLog();

    const res = await login('a@x.com', 'wrong-pass1');
    expect(res.status).toBe(401);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'auth.login',
      outcome: 'failure',
      status_code: 401,
      user_id: null,
      metadata: { email: 'a@x.com' },
    });
  });

  test('an unknown email is logged the same way as a wrong password', async () => {
    await login('ghost@x.com', 'wrong-pass1');
    const [row] = await logRows();
    expect(row).toMatchObject({ outcome: 'failure', status_code: 401, user_id: null });
  });

  test('a login stopped by the rate limiter is logged with status 429', async () => {
    await registerAndLogin('a@x.com');
    await clearLog();
    resetRateLimits();
    env.RATE_LIMIT_ENABLED = true;
    for (let n = 0; n < 6; n += 1) await login('a@x.com', 'wrong-pass1');

    // Compared as a sorted list: each row is written just after its response, so two quick
    // requests can be saved in either order.
    const rows = await logRows();
    expect(rows.map((r) => r.status_code).sort()).toEqual([401, 401, 401, 401, 401, 429]);
  });

  test('passwords are never stored, whatever the outcome', async () => {
    await register('a@x.com');
    await login('a@x.com');
    await login('a@x.com', 'wrong-pass1');
    await register('a@x.com', { password: 'another-secret9' });

    const rows = await logRows();
    expect(rows).toHaveLength(4);
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain('secret123');
    expect(everything).not.toContain('wrong-pass1');
    expect(everything).not.toContain('another-secret9');
    expect(everything).not.toMatch(/password/i);
  });
});

describe('money movement', () => {
  test('a deposit is logged with the user, the account and the amount', async () => {
    const a = await funded(1, 0);
    await clearLog();

    const res = await post(a.token, 'deposit', { accountId: a.account.id, amount: 5000 });
    expect(res.status).toBeLessThan(300);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'transaction.deposit',
      outcome: 'success',
      status_code: res.status,
      user_id: a.user.id,
      metadata: { accountId: a.account.id, amount: 5000 },
    });
  });

  test('a withdrawal is logged', async () => {
    const a = await funded(1, 10000);
    await clearLog();

    const res = await post(a.token, 'withdraw', { accountId: a.account.id, amount: 700 });
    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'transaction.withdraw',
      outcome: 'success',
      status_code: res.status,
      user_id: a.user.id,
      metadata: { accountId: a.account.id, amount: 700 },
    });
  });

  test('a transfer is logged with a MASKED destination, never the full number', async () => {
    const a = await funded(1);
    const b = await funded(2, 0);
    await clearLog();

    const res = await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.account.account_number,
      amount: 1500,
      description: 'private note',
    });
    expect(res.status).toBe(201);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'transaction.transfer',
      outcome: 'success',
      user_id: a.user.id,
      metadata: { fromAccountId: a.account.id, toAccount: 'XXXXXXXX0002', amount: 1500 },
    });
    expect(JSON.stringify(row)).not.toContain(b.account.account_number);
    expect(JSON.stringify(row)).not.toContain('private note');
  });

  test('a transfer to an account that does not exist is logged as a 404 failure', async () => {
    const a = await funded(1);
    await clearLog();

    const res = await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: '999999999999',
      amount: 100,
    });
    expect(res.status).toBe(404);

    const [row] = await logRows();
    expect(row).toMatchObject({ outcome: 'failure', status_code: 404, user_id: a.user.id });
    expect(row.metadata.toAccount).toBe('XXXXXXXX9999');
  });

  test('a transfer with too little money is logged as a failure', async () => {
    const a = await funded(1, 50);
    const b = await funded(2, 0);
    await clearLog();

    const res = await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.account.account_number,
      amount: 100,
    });
    expect(res.status).toBe(422);

    const [row] = await logRows();
    expect(row).toMatchObject({ outcome: 'failure', status_code: 422 });
  });

  test('a transfer refused for a missing Idempotency-Key is logged too', async () => {
    const a = await funded(1);
    await clearLog();

    const res = await post(a.token, 'transfer', { fromAccountId: a.account.id, amount: 1 }, null);
    expect(res.status).toBe(400);

    const [row] = await logRows();
    expect(row).toMatchObject({
      action: 'transaction.transfer',
      outcome: 'failure',
      status_code: 400,
    });
  });

  test('a transfer stopped by the rate limiter is logged with status 429', async () => {
    const a = await funded(1);
    await clearLog();
    resetRateLimits();
    env.RATE_LIMIT_ENABLED = true;
    for (let n = 0; n < 11; n += 1) {
      await post(a.token, 'transfer', {
        fromAccountId: a.account.id,
        toAccountNumber: '999999999999',
        amount: 1,
      });
    }

    const rows = await logRows();
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.status_code === 404)).toHaveLength(10);
    expect(rows.filter((r) => r.status_code === 429)).toHaveLength(1);
  });

  test('a request with no token is NOT logged (nobody can be named, and it would only be noise)', async () => {
    const res = await request(app)
      .post('/api/v1/transactions/transfer')
      .set('Idempotency-Key', 'audit-anon')
      .send({});
    expect(res.status).toBe(401);

    expect(await logRows()).toHaveLength(0);
  });

  test('reading data is not logged: history, accounts and /me', async () => {
    const a = await funded(1);
    await clearLog();

    await request(app).get('/api/v1/transactions').set('Authorization', `Bearer ${a.token}`);
    await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${a.token}`);
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${a.token}`);

    expect(await logRows()).toHaveLength(0);
  });
});

describe('the log itself', () => {
  test('20 requests at the same moment leave exactly 20 rows', async () => {
    await registerAndLogin('a@x.com');
    await clearLog();

    await Promise.all(Array.from({ length: 20 }, () => login('a@x.com', 'wrong-pass1')));

    expect(await logRows()).toHaveLength(20);
  });

  test('the address comes from the connection, not from a header the client can fake', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.99')
      .send({ email: 'ghost@x.com', password: 'wrong-pass1' });

    const [row] = await logRows();
    expect(row.ip_address).not.toContain('203.0.113.99');
  });

  test('a failed audit write does not break the request, and later requests are still logged', async () => {
    await registerAndLogin('a@x.com');
    await clearLog();
    jest.spyOn(auditRepository, 'insert').mockRejectedValueOnce(new Error('disk full'));

    const first = await login('a@x.com');
    await flushAuditWrites();
    const second = await login('a@x.com');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await logRows()).toHaveLength(1);
  });

  test('rows can be added but never changed', async () => {
    await login('ghost@x.com', 'wrong-pass1');
    const [row] = await logRows();

    await expect(
      pool.query(`UPDATE audit_logs SET outcome = 'success' WHERE id = $1`, [row.id])
    ).rejects.toMatchObject({ code: '23001', message: expect.stringMatching(/append-only/) });
    await expect(
      pool.query(`UPDATE audit_logs SET metadata = '{}' WHERE TRUE`)
    ).rejects.toMatchObject({ code: '23001' });
  });

  test('rows can never be deleted', async () => {
    await login('ghost@x.com', 'wrong-pass1');
    const [row] = await logRows();

    await expect(
      pool.query('DELETE FROM audit_logs WHERE id = $1', [row.id])
    ).rejects.toMatchObject({
      code: '23001',
    });
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toMatchObject({ code: '23001' });
    expect(await logRows()).toHaveLength(1);
  });

  test('the log survives the user it describes being deleted', async () => {
    const { user } = await registerAndLogin('a@x.com');
    await flushAuditWrites();
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    const rows = await logRows('user_id = $1', [user.id]);
    expect(rows.length).toBeGreaterThanOrEqual(2); // the sign-up and the login
  });

  test('the test helper can still empty the table between tests (TRUNCATE is not row-by-row)', async () => {
    await login('ghost@x.com', 'wrong-pass1');
    await resetDb();
    expect(await logRows()).toHaveLength(0);
  });

  test('outcome and status must agree with the allowed values', async () => {
    await expect(
      pool.query(
        `INSERT INTO audit_logs (action, outcome, status_code) VALUES ('auth.login', 'maybe', 200)`
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});
