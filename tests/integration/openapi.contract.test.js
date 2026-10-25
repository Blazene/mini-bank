const request = require('supertest');
const Ajv = require('ajv');
const app = require('../../src/app');
const spec = require('../../src/modules/docs/openapi');
const { pool, resetDb } = require('../helpers/db');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');

const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
const covered = new Set();
function check(route, method, response) {
  const definition = spec.paths[route][method].responses[response.status];
  expect(definition).toBeDefined();
  const resolved = definition.$ref
    ? spec.components.responses[definition.$ref.split('/').at(-1)]
    : definition;
  const schema = { ...resolved.content['application/json'].schema, components: spec.components };
  const valid = ajv.compile(schema);
  expect({ valid: valid(response.body), errors: valid.errors }).toEqual({
    valid: true,
    errors: null,
  });
  covered.add(`${method} ${route}`);
  return response.body;
}
const get = (route, token) =>
  request(app).get(`/api/v1${route}`).set('Authorization', `Bearer ${token}`);
const post = (route, body, token, key) => {
  const req = request(app).post(`/api/v1${route}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};
async function person(email) {
  const body = { email, fullName: 'Contract Test', password: 'contract123' };
  check('/auth/register', 'post', await post('/auth/register', body));
  return check(
    '/auth/login',
    'post',
    await post('/auth/login', { email, password: body.password })
  );
}

beforeEach(async () => {
  await resetDb();
  covered.clear();
});
afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('real PostgreSQL-backed responses for EVERY business operation match the published schemas', async () => {
  check('/health', 'get', await request(app).get('/api/v1/health'));
  const owner = await person('contract-owner@x.com');
  const other = await person('contract-other@x.com');
  const admin = await person('contract-admin@x.com');
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
  const elevated = check(
    '/auth/login',
    'post',
    await post('/auth/login', { email: admin.user.email, password: 'contract123' })
  );
  check('/auth/me', 'get', await get('/auth/me', owner.token));
  const account = check(
    '/accounts',
    'post',
    await post('/accounts', { type: 'savings' }, owner.token)
  ).account;
  const destination = check(
    '/accounts',
    'post',
    await post('/accounts', { type: 'current' }, other.token)
  ).account;
  check('/accounts', 'get', await get('/accounts', owner.token));
  check('/accounts/{id}', 'get', await get(`/accounts/${account.id}`, owner.token));
  check(
    '/transactions/deposit',
    'post',
    await post(
      '/transactions/deposit',
      { accountId: account.id, amount: 10000000 },
      owner.token,
      'contract-deposit-key'
    )
  );
  check(
    '/transactions/withdraw',
    'post',
    await post(
      '/transactions/withdraw',
      { accountId: account.id, amount: 100 },
      owner.token,
      'contract-withdraw-key'
    )
  );
  check(
    '/transactions/transfer',
    'post',
    await post(
      '/transactions/transfer',
      {
        fromAccountId: account.id,
        toAccountNumber: destination.accountNumber,
        amount: 100,
      },
      owner.token,
      'contract-transfer-key'
    )
  );
  check('/transactions', 'get', await get('/transactions?limit=1', owner.token));
  check(
    '/accounts/{id}/transactions',
    'get',
    await get(`/accounts/${account.id}/transactions`, owner.token)
  );
  const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
  check('/loans/quote', 'post', await post('/loans/quote', input, owner.token));
  const application = check(
    '/loans/applications',
    'post',
    await post('/loans/applications', input, owner.token, 'contract-application-key')
  ).application;
  check(
    '/loans/applications/{id}',
    'get',
    await get(`/loans/applications/${application.id}`, owner.token)
  );
  check(
    '/admin/loan-applications/{id}',
    'get',
    await get(`/admin/loan-applications/${application.id}`, elevated.token)
  );
  check(
    '/admin/loan-applications/{id}/review',
    'post',
    await post(
      `/admin/loan-applications/${application.id}/review`,
      {
        decision: 'approved',
        reason: 'Contract review explanation',
      },
      elevated.token
    )
  );
  const alerts = check('/admin/alerts', 'get', await get('/admin/alerts', elevated.token));
  check(
    '/admin/alerts/{id}',
    'get',
    await get(`/admin/alerts/${alerts.alerts[0].id}`, elevated.token)
  );
  await flushAuditWrites();
  check('/admin/audit-logs', 'get', await get('/admin/audit-logs', elevated.token));
  const expected = Object.entries(spec.paths).flatMap(([route, methods]) =>
    Object.keys(methods).map((method) => `${method} ${route}`)
  );
  expect([...covered].sort()).toEqual(expected.sort());
});

test('representative validation, authentication, ownership and eligibility errors match the contract', async () => {
  check('/auth/register', 'post', await post('/auth/register', {}));
  check('/auth/me', 'get', await request(app).get('/api/v1/auth/me'));
  const owner = await person('error-owner@x.com');
  check(
    '/accounts/{id}',
    'get',
    await get('/accounts/11111111-1111-4111-8111-111111111111', owner.token)
  );
  check('/admin/alerts', 'get', await get('/admin/alerts', owner.token));
  check(
    '/loans/applications',
    'post',
    await post(
      '/loans/applications',
      {
        principal: 10000000,
        tenureMonths: 12,
        monthlyIncome: 100,
      },
      owner.token,
      'contract-ineligible-key'
    )
  );
});
