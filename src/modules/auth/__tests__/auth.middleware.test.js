const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../../../config/env');
const errorHandler = require('../../../shared/middleware/errorHandler');
const { signAccessToken } = require('../auth.tokens');
const { requireAuth, requireRole } = require('../auth.middleware');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const tokenFor = (role) => signAccessToken({ id: USER_ID, role });

// A tiny app that exists only for this test. It uses the real middleware and the real
// errorHandler, so we test the same behaviour the real routes will get.
const app = express();
app.get('/protected', requireAuth, (req, res) => res.json({ user: req.user }));
app.get('/admin', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }));
app.get('/either', requireAuth, requireRole('admin', 'user'), (req, res) => res.json({ ok: true }));
app.get('/misordered', requireRole('admin'), (req, res) => res.json({ ok: true }));
app.use(errorHandler);

describe('requireAuth', () => {
  test('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('rejects a scheme that is not Bearer', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Basic YTpi');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('rejects "Bearer" with no token after it', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('rejects a token that is not a JWT', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer not-a-token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('rejects an expired token with TOKEN_EXPIRED', async () => {
    const expired = jwt.sign({ role: 'user' }, env.JWT_SECRET, {
      subject: USER_ID,
      algorithm: 'HS256',
      expiresIn: -10,
    });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('rejects a forged admin token signed with a different secret', async () => {
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret-some-other-secret-1', {
      subject: USER_ID,
      algorithm: 'HS256',
    });
    const res = await request(app).get('/admin').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('accepts a valid token and attaches only the id and role to req.user', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${tokenFor('user')}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USER_ID, role: 'user' });
  });

  test('treats the Bearer scheme name as case-insensitive', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `bearer ${tokenFor('user')}`);

    expect(res.status).toBe(200);
  });
});

describe('requireRole', () => {
  test('returns 403 FORBIDDEN when a user hits an admin route', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${tokenFor('user')}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('lets an admin through', async () => {
    const res = await request(app)
      .get('/admin')
      .set('Authorization', `Bearer ${tokenFor('admin')}`);

    expect(res.status).toBe(200);
  });

  test('returns 401, not 403, when there is no token at all', async () => {
    const res = await request(app).get('/admin');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('accepts any one of several allowed roles', async () => {
    const res = await request(app)
      .get('/either')
      .set('Authorization', `Bearer ${tokenFor('user')}`);

    expect(res.status).toBe(200);
  });

  test('fails closed with 401 if requireAuth was forgotten', async () => {
    const res = await request(app)
      .get('/misordered')
      .set('Authorization', `Bearer ${tokenFor('admin')}`);

    expect(res.status).toBe(401);
  });
});
