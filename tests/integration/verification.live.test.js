const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const env = require('../../src/config/env');
const { pool, resetDb } = require('../helpers/db');

let child;
let base;
let borrower;
let stranger;
let reviewer;

async function call(method, route, { token, body, key } = {}) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function person(email) {
  const registration = await call('POST', '/auth/register', {
    body: {
      email,
      fullName: 'Live Verification',
      password: 'verification123',
    },
  });
  expect(registration.status).toBe(201);
  const login = await call('POST', '/auth/login', { body: { email, password: 'verification123' } });
  expect(login.status).toBe(200);
  return { ...login.body, email };
}

beforeAll(async () => {
  await resetDb();
  const startup = new Promise((resolve, reject) => {
    child = fork(path.join(__dirname, '../helpers/live-server.js'), [], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.once('message', ({ port }) => {
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Live server exited during startup: ${code}`)));
  });
  await startup;
  borrower = await person('live-borrower@example.com');
  stranger = await person('live-stranger@example.com');
  reviewer = await person('live-reviewer@example.com');
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [reviewer.user.id]);
  reviewer = {
    ...reviewer,
    ...(
      await call('POST', '/auth/login', {
        body: {
          email: reviewer.email,
          password: 'verification123',
        },
      })
    ).body,
  };
}, 15000);

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    // A broken shutdown must fail a test, not leave a server behind indefinitely.
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      await stopped;
    } finally {
      clearTimeout(timeout);
    }
    expect(child.signalCode).toBeNull();
  }
  await resetDb();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [reviewer.user.id]);
});

test('live health and full loan flow enforce saved terms, owner access, roles and retry safety', async () => {
  const before = (await pool.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n;
  expect((await call('GET', '/health')).body).toEqual({ status: 'ok', database: 'up' });
  const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
  const quote = await call('POST', '/loans/quote', { token: borrower.token, body: input });
  expect(quote.status).toBe(200);
  expect(quote.body.quote.emi).toBe(888488);
  expect(quote.body.quote.schedule.at(-1).balance).toBe(0);
  const submitted = await Promise.all(
    Array.from({ length: 8 }, () =>
      call('POST', '/loans/applications', {
        token: borrower.token,
        body: { ...input, status: 'approved', annualRateBps: 0 },
        key: 'live-application-key',
      })
    )
  );
  expect(submitted.every((res) => res.status === 201)).toBe(true);
  expect(new Set(submitted.map((res) => res.body.application.id)).size).toBe(1);
  const application = submitted[0].body.application;
  expect(application.status).toBe('pending');
  expect(application.quote).toEqual(quote.body.quote);
  const unauthorized = await call('GET', `/loans/applications/${application.id}`, {
    token: stranger.token,
  });
  expect(unauthorized.status).toBe(404);
  const decision = { decision: 'approved', reason: 'Live verification approval reason' };
  expect(
    (
      await call('POST', `/admin/loan-applications/${application.id}/review`, {
        token: borrower.token,
        body: decision,
      })
    ).status
  ).toBe(403);
  const reviewed = await call('POST', `/admin/loan-applications/${application.id}/review`, {
    token: reviewer.token,
    body: decision,
  });
  expect(reviewed.status).toBe(200);
  const retry = await call('POST', `/admin/loan-applications/${application.id}/review`, {
    token: reviewer.token,
    body: decision,
  });
  expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
  expect(retry.body).toEqual(reviewed.body);
  expect((await pool.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n).toBe(before);
});

test('live transfers reconcile, retries move money once, and alerts stay admin-only', async () => {
  const source = (
    await call('POST', '/accounts', { token: borrower.token, body: { type: 'savings' } })
  ).body.account;
  const destination = (
    await call('POST', '/accounts', { token: stranger.token, body: { type: 'savings' } })
  ).body.account;
  const deposit = await call('POST', '/transactions/deposit', {
    token: borrower.token,
    body: { accountId: source.id, amount: 10000000 },
    key: 'live-deposit-key',
  });
  expect(deposit.status).toBe(201);
  for (let n = 1; n <= 5; n++) {
    const res = await call('POST', '/transactions/transfer', {
      token: borrower.token,
      body: { fromAccountId: source.id, toAccountNumber: destination.accountNumber, amount: 100 },
      key: `live-transfer-key-${n}`,
    });
    expect(res.status).toBe(201);
  }
  const retry = await call('POST', '/transactions/deposit', {
    token: borrower.token,
    body: { accountId: source.id, amount: 10000000 },
    key: 'live-deposit-key',
  });
  expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
  const balance = await call('GET', `/accounts/${source.id}`, { token: borrower.token });
  expect(balance.body.account.balance).toBe(9999500);
  const total = await pool.query('SELECT sum(balance)::text AS total FROM accounts');
  expect(total.rows[0].total).toBe('10000000');
  const alerts = await call('GET', '/admin/alerts', { token: reviewer.token });
  expect(alerts.status).toBe(200);
  expect(alerts.body.alerts.map((row) => row.ruleCode).sort()).toEqual([
    'LARGE_TRANSACTION',
    'RAPID_TRANSFERS',
  ]);
  expect((await call('GET', '/admin/alerts', { token: borrower.token })).status).toBe(403);
  const pending = await call('POST', '/loans/applications', {
    token: borrower.token,
    body: { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 },
    key: 'live-pending-role-test',
  });
  expect(pending.status).toBe(201);
  await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [reviewer.user.id]);
  expect((await call('GET', '/admin/alerts', { token: reviewer.token })).status).toBe(403);
  expect(
    (
      await call('GET', `/admin/loan-applications/${pending.body.application.id}`, {
        token: reviewer.token,
      })
    ).status
  ).toBe(403);
});

test.each(['gzip', 'deflate'])(
  'malformed %s payloads cannot terminate the real HTTP process',
  async (encoding) => {
    const frame = encoding === 'gzip' ? zlib.gzipSync('{}') : zlib.deflateSync('{}');
    const payload = Buffer.concat([frame, Buffer.from([255, 0, 255, 0, 255, 0])]);
    await new Promise((resolve, reject) => {
      const req = http.request(
        `${base}/api/v1/loans/quote`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': encoding,
            'Content-Length': payload.length,
          },
          timeout: 3000,
        },
        (res) => {
          res.resume();
          res.once('end', resolve);
          res.once('error', resolve);
        }
      );
      req.once('timeout', () => {
        req.destroy();
        reject(new Error('Malformed request hung'));
      });
      req.once('error', (error) => {
        if (error.code === 'ECONNRESET') resolve();
        else reject(error);
      });
      req.end(payload);
    });
    // A new TCP request must succeed even if the bad connection was closed/reset.
    const health = await call('GET', '/health');
    expect(health.status).toBe(200);
    expect(child.exitCode).toBeNull();
  }
);
