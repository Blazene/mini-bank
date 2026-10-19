const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const env = require('../../src/config/env');
const { pool, resetDb } = require('../helpers/db');

const account = { email: 'a@x.com', fullName: 'Anurag Raut', password: 'secret123' };

async function registerAndLogin() {
  await request(app).post('/api/v1/auth/register').send(account);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: account.email, password: account.password });
  return res.body;
}

const me = (token) => {
  const req = request(app).get('/api/v1/auth/me');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('returns the current user for a valid token, with no password data', async () => {
  const { token, user } = await registerAndLogin();
  const res = await me(token);

  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({
    id: user.id,
    email: 'a@x.com',
    fullName: 'Anurag Raut',
    role: 'user',
  });

  const body = JSON.stringify(res.body).toLowerCase();
  expect(body).not.toContain('password');
  expect(body).not.toContain('hash');
});

test('rejects a request with no token', async () => {
  const res = await me();

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('MISSING_TOKEN');
});

test('rejects a malformed token', async () => {
  const res = await me('garbage');

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('INVALID_TOKEN');
});

test('rejects an expired token', async () => {
  const { user } = await registerAndLogin();
  const expired = jwt.sign({ role: 'user' }, env.JWT_SECRET, {
    subject: user.id,
    algorithm: 'HS256',
    expiresIn: -10,
  });
  const res = await me(expired);

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('TOKEN_EXPIRED');
});

test('rejects a valid token whose user has been deleted', async () => {
  const { token } = await registerAndLogin();
  await pool.query('DELETE FROM users');
  const res = await me(token);

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('INVALID_TOKEN');
});

test('shows the current role from the database, while the token keeps the old one', async () => {
  const { token, user } = await registerAndLogin();
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
  const res = await me(token);

  expect(res.body.user.role).toBe('admin');
  expect(jwt.decode(token).role).toBe('user');
});
