// This endpoint is deliberately read-only: fail if it ever starts using SQL.
jest.mock('../../../config/db', () => ({
  query: jest.fn(() => {
    throw new Error('Quotes must not query the database');
  }),
}));

const request = require('supertest');
const app = require('../../../app');
const db = require('../../../config/db');
const { signAccessToken } = require('../../auth/auth.tokens');

const token = signAccessToken({ id: '11111111-1111-4111-8111-111111111111', role: 'user' });
const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
const post = (body) =>
  request(app).post('/api/v1/loans/quote').set('Authorization', `Bearer ${token}`).send(body);

afterEach(() => {
  expect(db.query).not.toHaveBeenCalled();
});

test('requires authentication before body validation', async () => {
  const res = await request(app).post('/api/v1/loans/quote').send({ principal: -1 });
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('MISSING_TOKEN');
});

test('rejects invalid tokens', async () => {
  const res = await request(app)
    .post('/api/v1/loans/quote')
    .set('Authorization', 'Bearer invalid')
    .send(input);
  expect(res.status).toBe(401);
});

test('returns an authenticated quote without an idempotency key', async () => {
  const res = await post(input);
  expect(res.status).toBe(200);
  expect(res.body.quote).toMatchObject({
    emi: 888488,
    annualRateBps: 1200,
    eligibility: { eligible: true, reasons: [] },
  });
  expect(res.body.quote.schedule).toHaveLength(12);
  expect(res.body.quote.schedule[11].balance).toBe(0);
});

test('returns ineligibility as a successful calculation, not an HTTP error', async () => {
  const res = await post({ ...input, monthlyIncome: 100 });
  expect(res.status).toBe(200);
  expect(res.body.quote.eligibility.eligible).toBe(false);
});

test('ignores attempts to set the rate or override eligibility', async () => {
  const res = await post({ ...input, annualRateBps: 0, eligible: true, userId: 'other' });
  expect(res.body.quote.annualRateBps).toBe(1200);
  expect(res.body.quote.emi).toBe(888488);
  expect(res.body.quote).not.toHaveProperty('userId');
});

test.each([
  {},
  { ...input, principal: '10000000' },
  { ...input, tenureMonths: 361 },
  { ...input, monthlyIncome: 0 },
  { ...input, existingMonthlyEmi: -1 },
])('returns consistent validation errors for %p', async (body) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(res.body.error.details.length).toBeGreaterThan(0);
});

test('identical requests produce identical quotes', async () => {
  expect((await post(input)).body).toEqual((await post(input)).body);
});
