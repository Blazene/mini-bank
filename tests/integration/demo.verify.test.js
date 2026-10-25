const { once } = require('node:events');
const env = require('../../src/config/env');
// Exercise the production-style closed/unlisted-origin behavior without changing .env.
env.CORS_ORIGINS = ['https://allowed.example'];
const app = require('../../src/app');
const { main } = require('../../scripts/verify-demo');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');
const { pool, resetDb } = require('../helpers/db');
let server;
let base;

beforeAll(async () => {
  await resetDb();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await flushAuditWrites();
  await resetDb();
  await pool.end();
});

test('read-only demo verification does not create users/accounts/money/applications', async () => {
  const log = jest.fn(),
    error = jest.fn();
  expect(await main(['--base-url', base], { log, error })).toBe(0);
  expect(error).not.toHaveBeenCalled();
  const counts = await pool.query(
    'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM loan_applications) AS applications'
  );
  expect(counts.rows[0]).toEqual({
    users: '0',
    accounts: '0',
    transactions: '0',
    applications: '0',
  });
});

test('the documented writable demo completes against real PostgreSQL with exact final state', async () => {
  const log = jest.fn(),
    error = jest.fn();
  expect(await main(['--base-url', base, '--write'], { log, error })).toBe(0);
  expect(error).not.toHaveBeenCalled();
  expect(log.mock.calls.flat().join(' ')).toContain('Demo complete');
  const counts = await pool.query(
    'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM transactions) AS transactions, (SELECT count(*) FROM loan_applications) AS applications'
  );
  expect(counts.rows[0]).toEqual({
    users: '2',
    accounts: '2',
    transactions: '3',
    applications: '1',
  });
  expect((await pool.query('SELECT balance::text FROM accounts ORDER BY balance')).rows).toEqual([
    { balance: '25000' },
    { balance: '65000' },
  ]);
  expect((await pool.query('SELECT status FROM loan_applications')).rows).toEqual([
    { status: 'pending' },
  ]);
  expect((await pool.query("SELECT count(*) FROM users WHERE role = 'admin'")).rows[0].count).toBe(
    '0'
  );
});
