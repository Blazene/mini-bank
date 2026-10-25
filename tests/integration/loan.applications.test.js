const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createUser, createAccount } = require('../helpers/db');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');

const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
let user;
let token;
const apply = (body = input, key = 'loan-key-0001', auth = token) => {
  const req = request(app).post('/api/v1/loans/applications');
  if (auth) req.set('Authorization', `Bearer ${auth}`);
  if (key !== null) req.set('Idempotency-Key', key);
  return req.send(body);
};
const get = (id, auth = token) =>
  request(app).get(`/api/v1/loans/applications/${id}`).set('Authorization', `Bearer ${auth}`);

beforeEach(async () => {
  await resetDb();
  user = await createUser();
  token = signAccessToken({ id: user.id, role: 'user' });
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('creates a pending application with server-owned terms and reads it back', async () => {
  const res = await apply({ ...input, status: 'approved', annualRateBps: 0, userId: 'other' });
  expect(res.status).toBe(201);
  expect(res.headers['idempotent-replayed']).toBeUndefined();
  const application = res.body.application;
  expect(application).toMatchObject({
    ...input,
    existingMonthlyEmi: 0,
    status: 'pending',
    quote: { emi: 888488, annualRateBps: 1200, eligibility: { eligible: true } },
  });
  expect(application.quote.schedule).toHaveLength(12);
  expect(application).not.toHaveProperty('userId');
  expect(application).not.toHaveProperty('idempotencyKey');
  const read = await get(application.id);
  expect(read.status).toBe(200);
  expect(read.body.application).toEqual(application);
});

test('both application routes require authentication', async () => {
  expect((await apply({}, null, null)).status).toBe(401);
  expect((await request(app).get('/api/v1/loans/applications/not-a-uuid')).status).toBe(401);
});

test.each([null, 'short'])('requires a valid idempotency key (%p)', async (key) => {
  expect((await apply(input, key)).status).toBe(400);
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(0);
});

test.each([
  {},
  { ...input, principal: -1 },
  { ...input, tenureMonths: 361 },
  { ...input, monthlyIncome: '5000000' },
])('invalid inputs are refused without a row (%p)', async (body) => {
  const res = await apply(body);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(0);
});

test('ineligible attempts are not persisted and can retry with corrected input', async () => {
  const refused = await apply({ ...input, monthlyIncome: 100000 });
  expect(refused.status).toBe(422);
  expect(refused.body.error.code).toBe('LOAN_INELIGIBLE');
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(0);
  expect((await apply()).status).toBe(201);
});

test('same-key retries return the saved application and default debt normalizes to zero', async () => {
  const first = await apply();
  const retry = await apply({ ...input, existingMonthlyEmi: 0 });
  expect(retry.status).toBe(201);
  expect(retry.headers['idempotent-replayed']).toBe('true');
  expect(retry.body).toEqual(first.body);
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(1);
});

test.each([
  ['principal', 9000000],
  ['tenureMonths', 24],
  ['monthlyIncome', 6000000],
  ['existingMonthlyEmi', 1],
])('same key with changed %s is refused', async (field, value) => {
  const first = await apply();
  const retry = await apply({ ...input, [field]: value });
  expect(retry.status).toBe(422);
  expect(retry.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  expect((await get(first.body.application.id)).body).toEqual(first.body);
});

test('keys are scoped per user', async () => {
  const other = await createUser('other@x.com');
  const otherToken = signAccessToken({ id: other.id, role: 'user' });
  const first = await apply();
  const second = await apply(input, 'loan-key-0001', otherToken);
  expect(second.status).toBe(201);
  expect(second.body.application.id).not.toBe(first.body.application.id);
});

test('someone else’s application and a missing id return identical 404s, even for admins', async () => {
  const first = await apply();
  const other = await createUser('admin@x.com');
  const admin = signAccessToken({ id: other.id, role: 'admin' });
  const foreign = await get(first.body.application.id, admin);
  const missing = await get('11111111-1111-4111-8111-111111111111', admin);
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(foreign.body).toEqual(missing.body);
  expect((await get('invalid-id')).status).toBe(400);
});

test('ten simultaneous retries create exactly one application', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => apply()));
  expect(results.every((res) => res.status === 201)).toBe(true);
  expect(new Set(results.map((res) => res.body.application.id)).size).toBe(1);
  expect(results.filter((res) => res.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(1);
});

test('concurrent conflicting requests create one winner and reject all differing payloads', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => apply({ ...input, principal: input.principal + i }))
  );
  expect(results.filter((res) => res.status === 201)).toHaveLength(1);
  const refused = results.filter((res) => res.status === 422);
  expect(refused).toHaveLength(9);
  expect(refused.every((res) => res.body.error.code === 'IDEMPOTENCY_KEY_REUSED')).toBe(true);
  expect((await pool.query('SELECT * FROM loan_applications')).rows).toHaveLength(1);
});

test('applications do not change account balances or create ledger rows', async () => {
  const account = await createAccount(user.id, '123456789012', 500000);
  expect((await apply()).status).toBe(201);
  expect(
    (await pool.query('SELECT balance FROM accounts WHERE id = $1', [account.id])).rows[0].balance
  ).toBe('500000');
  expect((await pool.query('SELECT * FROM transactions')).rows).toHaveLength(0);
});

test('audit captures successful and refused attempts but excludes income and debt', async () => {
  await apply({ ...input, existingMonthlyEmi: 12345 });
  await apply({ ...input, monthlyIncome: 100 }, 'loan-key-0002');
  await flushAuditWrites();
  const { rows } = await pool.query("SELECT * FROM audit_logs WHERE action = 'loan.apply'");
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.outcome).sort()).toEqual(['failure', 'success']);
  for (const row of rows) {
    expect(row.user_id).toBe(user.id);
    expect(row.metadata).toEqual({ principal: input.principal, tenureMonths: 12 });
  }
});

test.each([
  ['principal', 0],
  ['tenure_months', 361],
  ['monthly_income', 0],
  ['existing_monthly_emi', -1],
  ['status', 'approved'],
  ['quote', '[]'],
  ['idempotency_key', 'short'],
])('database rejects invalid %s independently of API validation', async (column, value) => {
  const res = await apply();
  // Column names here come only from the fixed test cases, never HTTP input.
  await expect(
    pool.query(`UPDATE loan_applications SET ${column} = $1 WHERE id = $2`, [
      value,
      res.body.application.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
});
