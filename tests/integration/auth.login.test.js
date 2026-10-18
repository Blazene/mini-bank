const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const env = require('../../src/config/env');
const { pool, resetDb } = require('../helpers/db');

const account = { email: 'a@x.com', fullName: 'Anurag Raut', password: 'secret123' };
const register = (body) => request(app).post('/api/v1/auth/register').send(body);
const login = (body) => request(app).post('/api/v1/auth/login').send(body);

beforeEach(async () => {
  await resetDb();
  await register(account);
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('logs in with correct credentials and returns a token and the user', async () => {
  const res = await login({ email: account.email, password: account.password });

  expect(res.status).toBe(200);
  expect(res.body.token).toEqual(expect.any(String));
  expect(res.body.user).toMatchObject({ email: 'a@x.com', fullName: 'Anurag Raut', role: 'user' });

  const body = JSON.stringify(res.body.user).toLowerCase();
  expect(body).not.toContain('password');
  expect(body).not.toContain('hash');
});

test('the token is signed, identifies the user, and expires in one hour', async () => {
  const res = await login({ email: account.email, password: account.password });
  const payload = jwt.verify(res.body.token, env.JWT_SECRET);

  expect(payload.sub).toBe(res.body.user.id);
  expect(payload.role).toBe('user');
  expect(payload.exp - payload.iat).toBe(3600);
  expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
});

test('accepts the email in a different case with extra spaces', async () => {
  const res = await login({ email: '  A@X.COM ', password: account.password });

  expect(res.status).toBe(200);
});

test('rejects a wrong password with 401 and no token', async () => {
  const res = await login({ email: account.email, password: 'wrong-password1' });

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  expect(res.body.token).toBeUndefined();
});

test('gives the same response for an unknown email as for a wrong password', async () => {
  const wrongPassword = await login({ email: account.email, password: 'wrong-password1' });
  const unknownEmail = await login({ email: 'nobody@x.com', password: 'wrong-password1' });

  expect(unknownEmail.status).toBe(401);
  expect(unknownEmail.body).toEqual(wrongPassword.body);
});

test('rejects an empty password with 400', async () => {
  const res = await login({ email: account.email, password: '' });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});

test('rejects a missing email with 400', async () => {
  const res = await login({ password: account.password });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
});
