const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createUser, createAccount } = require('../helpers/db');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');

let borrower;
let admin;
let ownerToken;
let adminToken;
let id;
const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
const decision = { decision: 'approved', reason: 'Income documents reviewed' };
const tokenFor = (user, role = 'user') => signAccessToken({ id: user.id, role });
const review = (body = decision, token = adminToken, applicationId = id) => {
  const req = request(app).post(`/api/v1/admin/loan-applications/${applicationId}/review`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
};
const adminGet = (token = adminToken, applicationId = id) =>
  request(app)
    .get(`/api/v1/admin/loan-applications/${applicationId}`)
    .set('Authorization', `Bearer ${token}`);
const ownerGet = () =>
  request(app).get(`/api/v1/loans/applications/${id}`).set('Authorization', `Bearer ${ownerToken}`);

async function makeAdmin(email) {
  const user = await createUser(email);
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
  return { ...user, role: 'admin' };
}

beforeEach(async () => {
  await resetDb();
  borrower = await createUser('borrower@x.com');
  admin = await makeAdmin('reviewer@x.com');
  ownerToken = tokenFor(borrower);
  adminToken = tokenFor(admin, 'admin');
  const res = await request(app)
    .post('/api/v1/loans/applications')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('Idempotency-Key', 'loan-review-test')
    .send(input);
  expect(res.status).toBe(201);
  id = res.body.application.id;
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

test.each(['approved', 'rejected'])(
  'records %s and exposes the reason to the owner',
  async (status) => {
    const before = (await ownerGet()).body.application;
    expect(before.review).toBeNull();
    const result = await review({ ...decision, decision: status, reason: ` ${decision.reason} ` });
    expect(result.status).toBe(200);
    expect(result.body.application).toMatchObject({
      status,
      review: { reason: decision.reason, reviewedAt: expect.any(String) },
    });
    expect(result.body.application.quote).toEqual(before.quote);
    expect(result.body.application).not.toHaveProperty('reviewedBy');
    expect(result.body.application).not.toHaveProperty('userId');
    const owner = await ownerGet();
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual(result.body);
    const stored = (await pool.query('SELECT * FROM loan_applications WHERE id = $1', [id]))
      .rows[0];
    expect(stored.reviewed_by).toBe(admin.id);
    expect(stored.status).toBe(status);
  }
);

test('admin-only read supports reviewing declared data, but customer route stays owner-only', async () => {
  const res = await adminGet();
  expect(res.status).toBe(200);
  expect(res.body.application.monthlyIncome).toBe(input.monthlyIncome);
  expect(
    (
      await request(app)
        .get(`/api/v1/loans/applications/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
    ).status
  ).toBe(404);
  expect((await adminGet(ownerToken)).status).toBe(403);
});

test('authentication and role checks run before validation or loan access', async () => {
  expect((await review({}, null, 'invalid')).status).toBe(401);
  expect((await review({}, 'invalid', 'invalid')).status).toBe(401);
  expect((await review({}, ownerToken, 'invalid')).status).toBe(403);
  expect((await request(app).get('/api/v1/admin/loan-applications/invalid')).status).toBe(401);
});

test('a demoted admin cannot read, write or replay using a still-valid admin JWT', async () => {
  expect((await review()).status).toBe(200);
  await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [admin.id]);
  expect((await adminGet()).status).toBe(403);
  expect((await review()).status).toBe(403);
  expect((await ownerGet()).body.application.status).toBe('approved');
});

test('a deleted admin is refused even with a previously valid JWT', async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [admin.id]);
  expect((await adminGet()).status).toBe(401);
  expect((await review()).status).toBe(401);
});

test('a promoted user must log in again to acquire an admin JWT', async () => {
  const other = await createUser('promoted@x.com');
  const oldToken = tokenFor(other);
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [other.id]);
  expect((await review(decision, oldToken)).status).toBe(403);
});

test('self approval and self rejection are forbidden', async () => {
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [borrower.id]);
  const self = tokenFor(borrower, 'admin');
  for (const status of ['approved', 'rejected']) {
    const res = await review({ ...decision, decision: status }, self);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_REVIEW_FORBIDDEN');
  }
  expect((await ownerGet()).body.application.status).toBe('pending');
});

test.each([
  {},
  { decision: 'pending', reason: decision.reason },
  { decision: 'approved', reason: 'short' },
  { decision: 'rejected', reason: 'x'.repeat(501) },
  { decision: 'approved', reason: ' '.repeat(20) },
])('invalid review changes nothing: %p', async (body) => {
  const res = await review(body);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect((await ownerGet()).body.application).toMatchObject({ status: 'pending', review: null });
});

test('invalid ids return 400 and missing applications return 404', async () => {
  expect((await review(decision, adminToken, 'invalid')).status).toBe(400);
  const missing = '11111111-1111-4111-8111-111111111111';
  expect((await review(decision, adminToken, missing)).status).toBe(404);
  expect((await adminGet(adminToken, missing)).status).toBe(404);
});

test('identical retries return the original timestamp without an idempotency key', async () => {
  const first = await review();
  const second = await review();
  expect(first.headers['idempotent-replayed']).toBeUndefined();
  expect(second.status).toBe(200);
  expect(second.headers['idempotent-replayed']).toBe('true');
  expect(second.body).toEqual(first.body);
});

test.each(['approved', 'rejected'])(
  'terminal %s decisions cannot be reversed or have their explanation replaced',
  async (initial) => {
    const original = { ...decision, decision: initial };
    const first = await review(original);
    for (const body of [
      { ...original, decision: initial === 'approved' ? 'rejected' : 'approved' },
      { ...original, reason: 'Replacement explanation' },
    ]) {
      const res = await review(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LOAN_ALREADY_REVIEWED');
    }
    expect((await ownerGet()).body).toEqual(first.body);
  }
);

test('unknown body fields cannot change quote terms, applicant or reviewer', async () => {
  const before = (await ownerGet()).body.application;
  const result = await review({
    ...decision,
    userId: admin.id,
    reviewedBy: borrower.id,
    principal: 1,
    quote: { emi: 0 },
    status: 'pending',
  });
  expect(result.status).toBe(200);
  expect(result.body.application.principal).toBe(before.principal);
  expect(result.body.application.quote).toEqual(before.quote);
  const row = (
    await pool.query('SELECT user_id, reviewed_by FROM loan_applications WHERE id=$1', [id])
  ).rows[0];
  expect(row).toEqual({ user_id: borrower.id, reviewed_by: admin.id });
});

test.each(['😀'.repeat(5), 'Explanation with a null\u0000', 'Invalid surrogate \ud800'])(
  'unsupported review text returns 400 instead of a database error',
  async (reason) => {
    expect((await review({ ...decision, reason })).status).toBe(400);
    expect((await ownerGet()).body.application.status).toBe('pending');
  }
);

test('a Unicode reason at the maximum length survives a database round trip', async () => {
  const reason = '😀'.repeat(500);
  const res = await review({ ...decision, reason });
  expect(res.status).toBe(200);
  expect((await ownerGet()).body.application.review.reason).toBe(reason);
});

test('audit bounds invalid path identifiers and still records validation failures', async () => {
  await review(decision, adminToken, 'x'.repeat(200));
  await flushAuditWrites();
  const rows = (await pool.query("SELECT * FROM audit_logs WHERE action = 'loan.review'")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].status_code).toBe(400);
  expect(rows[0].metadata.resourceId).toBe('x'.repeat(64));
});

test('rollback migration works for pending records and restores cleanly inside a transaction', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs
    .readFileSync(path.join(__dirname, '../../db/migrations/1792972800000_loan-review.sql'), 'utf8')
    .split('-- Down Migration')[1];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='loan_applications'"
    );
    expect(rows.map((row) => row.column_name)).not.toContain('reviewed_by');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await ownerGet()).status).toBe(200);
});

test('rollback migration refuses to erase existing decisions', async () => {
  expect((await review()).status).toBe(200);
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs
    .readFileSync(path.join(__dirname, '../../db/migrations/1792972800000_loan-review.sql'), 'utf8')
    .split('-- Down Migration')[1];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql)).rejects.toThrow('Cannot undo loan review migration');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await ownerGet()).body.application.status).toBe('approved');
});

test('another admin cannot overwrite or replay someone else’s decision', async () => {
  const other = await makeAdmin('other-admin@x.com');
  await review();
  const res = await review(decision, tokenFor(other, 'admin'));
  expect(res.status).toBe(409);
});

test('ten identical simultaneous reviews write once and replay nine times', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => review()));
  expect(results.every((res) => res.status === 200)).toBe(true);
  expect(results.filter((res) => res.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
  expect(new Set(results.map((res) => res.body.application.review.reviewedAt)).size).toBe(1);
});

test('competing approvals and rejections from different admins produce one winner', async () => {
  const other = await makeAdmin('other-admin@x.com');
  const otherToken = tokenFor(other, 'admin');
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      review(
        {
          decision: i % 2 ? 'rejected' : 'approved',
          reason: `Unique review explanation ${i}`,
        },
        i % 2 ? otherToken : adminToken
      )
    )
  );
  expect(results.filter((res) => res.status === 200)).toHaveLength(1);
  expect(results.filter((res) => res.status === 409)).toHaveLength(9);
  const winner = results.find((res) => res.status === 200);
  expect((await ownerGet()).body).toEqual(winner.body);
});

test('approval neither credits an account nor writes a transaction', async () => {
  const account = await createAccount(borrower.id, '123456789012', 500000);
  expect((await review()).status).toBe(200);
  expect(
    (await pool.query('SELECT balance FROM accounts WHERE id = $1', [account.id])).rows[0].balance
  ).toBe('500000');
  expect((await pool.query('SELECT * FROM transactions')).rows).toHaveLength(0);
});

test('application submission replay after review preserves terms and returns current review status', async () => {
  await review();
  const replay = await request(app)
    .post('/api/v1/loans/applications')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('Idempotency-Key', 'loan-review-test')
    .send(input);
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotent-replayed']).toBe('true');
  expect(replay.body.application.status).toBe('approved');
  expect(replay.body.application.id).toBe(id);
});

test('audit records target id and result but excludes review reasons and financial data', async () => {
  await review();
  await review({ ...decision, decision: 'rejected' });
  await review(decision, ownerToken);
  await flushAuditWrites();
  const rows = (await pool.query("SELECT * FROM audit_logs WHERE action = 'loan.review'")).rows;
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.status_code).sort()).toEqual([200, 403, 409]);
  for (const row of rows) {
    expect(row.metadata).toEqual({
      resourceId: id,
      decision: expect.stringMatching(/approved|rejected/),
    });
    expect(JSON.stringify(row.metadata)).not.toContain(decision.reason);
  }
  const logs = await request(app)
    .get('/api/v1/admin/audit-logs?action=loan.review')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(logs.status).toBe(200);
});

test('database blocks self-review and inconsistent decision metadata independently of HTTP', async () => {
  for (const params of [
    ['approved', borrower.id, decision.reason, new Date()],
    ['approved', admin.id, null, new Date()],
    ['approved', admin.id, 'short', new Date()],
    ['approved', null, decision.reason, new Date()],
    ['approved', admin.id, decision.reason, null],
    ['pending', admin.id, decision.reason, new Date()],
    ['unknown', admin.id, decision.reason, new Date()],
  ]) {
    await expect(
      pool.query(
        `UPDATE loan_applications SET status=$1, reviewed_by=$2,
      review_reason=$3, reviewed_at=$4 WHERE id=$5`,
        [...params, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  }
  expect((await ownerGet()).body.application.status).toBe('pending');
});
