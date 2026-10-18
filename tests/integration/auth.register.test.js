const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../src/app');
const { pool, resetDb } = require('../helpers/db');

const valid = { email: 'a@x.com', fullName: 'Anurag Raut', password: 'secret123' };
const register = (body) => request(app).post('/api/v1/auth/register').send(body);
const countUsers = async () => (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('registers a user and returns 201 without any password data', async () => {
  const res = await register(valid);

  expect(res.status).toBe(201);
  expect(res.body.user).toMatchObject({ email: 'a@x.com', fullName: 'Anurag Raut', role: 'user' });
  expect(res.body.user.id).toEqual(expect.any(String));

  const body = JSON.stringify(res.body).toLowerCase();
  expect(body).not.toContain('password');
  expect(body).not.toContain('hash');
});

test('stores a bcrypt hash, never the plain password', async () => {
  await register(valid);

  const { rows } = await pool.query('SELECT password_hash FROM users');
  const hash = rows[0].password_hash;

  expect(hash).not.toBe(valid.password);
  expect(hash).toMatch(/^\$2[aby]\$/);
  expect(await bcrypt.compare(valid.password, hash)).toBe(true);
});

test('normalises the email before saving', async () => {
  const res = await register({ ...valid, email: '  A@X.COM ' });

  expect(res.status).toBe(201);
  expect(res.body.user.email).toBe('a@x.com');
});

test('rejects a duplicate email, even in a different case, with 409', async () => {
  await register(valid);
  const res = await register({ ...valid, email: 'A@X.com' });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('EMAIL_TAKEN');
  expect(await countUsers()).toBe(1);
});

test('rejects invalid input with 400 and a list of problems, and saves nothing', async () => {
  const res = await register({ email: 'not-an-email', fullName: 'A', password: 'short' });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  const fields = res.body.error.details.map((d) => d.field);
  expect(fields).toEqual(expect.arrayContaining(['email', 'fullName', 'password']));
  expect(await countUsers()).toBe(0);
});

test('ignores a role sent by the client', async () => {
  const res = await register({ ...valid, role: 'admin' });

  expect(res.status).toBe(201);
  expect(res.body.user.role).toBe('user');
});

test('rejects malformed JSON with 400 and a clean error', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .set('Content-Type', 'application/json')
    .send('{"email": "a@x.com",');

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('INVALID_JSON');
  expect(res.body.error.message).toBe('Request body is not valid JSON');
});

test('rejects a request body over the 10 KB limit with 413', async () => {
  const res = await register({ ...valid, fullName: 'x'.repeat(11 * 1024) });

  expect(res.status).toBe(413);
  expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
});
