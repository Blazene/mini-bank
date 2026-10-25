const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createUser, createAccount } = require('../helpers/db');
const { insertTransaction } = require('../helpers/ledger');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');

let admin;
let adminToken;
let userToken;
let account;
let otherAccount;
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const get = (query = {}, token = adminToken) => {
  const req = request(app).get('/api/v1/admin/alerts').query(query);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const detail = (alertId, token = adminToken) =>
  request(app).get(`/api/v1/admin/alerts/${alertId}`).set('Authorization', `Bearer ${token}`);

async function seed(
  n,
  {
    micros = n,
    ruleCode = 'LARGE_TRANSACTION',
    accountId = account.id,
    timestamp = `2026-10-25T12:00:00.${String(micros).padStart(6, '0')}Z`,
  } = {}
) {
  const txId = await insertTransaction({ to: accountId });
  await pool.query(
    `INSERT INTO monitoring_alerts
    (id, transaction_id, account_id, rule_code, severity, details, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [
      id(n),
      txId,
      accountId,
      ruleCode,
      ruleCode === 'RAPID_TRANSFERS' ? 'high' : 'medium',
      JSON.stringify({ ruleVersion: 1 }),
      timestamp,
    ]
  );
  return txId;
}
beforeEach(async () => {
  await resetDb();
  admin = await createUser('admin@x.com');
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  adminToken = signAccessToken({ id: admin.id, role: 'admin' });
  const user = await createUser('user@x.com');
  userToken = signAccessToken({ id: user.id, role: 'user' });
  account = await createAccount(user.id, '123456789012', 100);
  otherAccount = await createAccount(user.id, '123456789013', 0);
});
afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('list and detail require admin authentication before validation', async () => {
  expect((await get({ limit: 'bad' }, null)).status).toBe(401);
  expect((await get({}, 'invalid')).status).toBe(401);
  expect((await get({ limit: 'bad' }, userToken)).status).toBe(403);
  expect((await detail('bad', userToken)).status).toBe(403);
  expect((await request(app).get('/api/v1/admin/alerts/bad')).status).toBe(401);
});
test('fresh role check blocks demoted admins on both routes', async () => {
  await seed(1);
  await pool.query("UPDATE users SET role='user' WHERE id=$1", [admin.id]);
  expect((await get()).status).toBe(403);
  expect((await detail(id(1))).status).toBe(403);
});
test('deleted admins cannot use a still-valid token', async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [admin.id]);
  expect((await get()).status).toBe(401);
  expect((await detail(id(1))).status).toBe(401);
});
test('empty collection returns complete pagination', async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    alerts: [],
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  });
});
test('detail and list present only documented alert fields, without account numbers or descriptions', async () => {
  const txId = await seed(1);
  const res = await detail(id(1));
  expect(res.status).toBe(200);
  expect(res.body.alert).toEqual({
    id: id(1),
    transactionId: txId,
    accountId: account.id,
    ruleCode: 'LARGE_TRANSACTION',
    severity: 'medium',
    details: { ruleVersion: 1 },
    createdAt: '2026-10-25T12:00:00.000Z',
  });
  expect((await get()).body.alerts[0]).toEqual(res.body.alert);
  expect(JSON.stringify(res.body)).not.toContain(account.account_number);
});
test('invalid ids return 400 and missing alert returns 404', async () => {
  expect((await detail('bad')).status).toBe(400);
  const missing = await detail(id(99));
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('ALERT_NOT_FOUND');
});
test.each([
  { limit: '0' },
  { limit: '101' },
  { limit: 'x' },
  { ruleCode: 'UNKNOWN' },
  { severity: 'low' },
  { accountId: 'bad' },
  { transactionId: 'bad' },
  { cursor: 'garbage' },
  { from: '2026-02-30T00:00:00Z' },
  { from: '0000-01-01T00:00:00Z' },
  { from: '2026-10-26T00:00:00Z', to: '2026-10-25T00:00:00Z' },
])('rejects malformed filters %p', async (query) => {
  const res = await get(query);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});
test('filters combine by rule, severity, account and transaction', async () => {
  await seed(1);
  const txId = await seed(2, { ruleCode: 'RAPID_TRANSFERS', accountId: otherAccount.id });
  expect(
    (
      await get({
        ruleCode: 'RAPID_TRANSFERS',
        severity: 'high',
        accountId: otherAccount.id,
        transactionId: txId,
      })
    ).body.alerts.map((row) => row.id)
  ).toEqual([id(2)]);
  expect((await get({ ruleCode: 'RAPID_TRANSFERS', severity: 'medium' })).body.alerts).toEqual([]);
  expect((await get({ accountId: account.id })).body.alerts.map((row) => row.id)).toEqual([id(1)]);
  expect((await get({ transactionId: txId })).body.alerts.map((row) => row.id)).toEqual([id(2)]);
});
test('date range includes from and excludes to', async () => {
  await seed(1, { timestamp: '2026-10-25T12:00:00.000000Z' });
  await seed(2, { timestamp: '2026-10-25T12:01:00.000000Z' });
  await seed(3, { timestamp: '2026-10-25T12:02:00.000000Z' });
  expect(
    (await get({ from: '2026-10-25T12:01:00Z', to: '2026-10-25T12:02:00Z' })).body.alerts.map(
      (row) => row.id
    )
  ).toEqual([id(2)]);
});
test('cursor walk preserves microseconds and id tie-breakers without repeats or gaps', async () => {
  for (const n of [2, 4, 1, 5, 3]) await seed(n, { micros: n <= 3 ? 1 : 2 });
  const seen = [];
  let cursor;
  do {
    const res = await get({ limit: '2', ...(cursor ? { cursor } : {}) });
    expect(res.status).toBe(200);
    seen.push(...res.body.alerts.map((row) => row.id));
    expect(res.body.alerts.every((row) => row.cursorTs === undefined)).toBe(true);
    cursor = res.body.pagination.nextCursor;
  } while (cursor);
  expect(seen).toEqual([id(5), id(4), id(3), id(2), id(1)]);
});
test('newer inserts do not shift the next page', async () => {
  for (let n = 1; n <= 4; n++) await seed(n);
  const first = await get({ limit: '2' });
  await seed(5);
  const next = await get({ limit: '2', cursor: first.body.pagination.nextCursor });
  expect(next.body.alerts.map((row) => row.id)).toEqual([id(2), id(1)]);
  expect(next.body.pagination).toEqual({ limit: 2, hasMore: false, nextCursor: null });
});
test('rollback migration refuses to erase existing alerts', async () => {
  await seed(1);
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs
    .readFileSync(
      path.join(__dirname, '../../db/migrations/1793059200000_monitoring-alerts.sql'),
      'utf8'
    )
    .split('-- Down Migration')[1];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql)).rejects.toThrow('Cannot undo monitoring migration');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await detail(id(1))).status).toBe(200);
});
