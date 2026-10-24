jest.mock('../audit.service');
jest.mock('../../../shared/utils/logger', () => ({ error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const service = require('../audit.service');
const logger = require('../../../shared/utils/logger');
const { audit } = require('../audit.middleware');

// A tiny app with one route whose status code we control, to watch what gets recorded.
function appWith(middleware, handler) {
  const app = express();
  app.use(express.json());
  app.post('/x', ...middleware, handler);
  return app;
}

const reply =
  (status, locals = {}) =>
  (req, res) => {
    Object.assign(res.locals, locals);
    res.status(status).json({ ok: status < 400 });
  };

beforeEach(() => {
  jest.resetAllMocks();
});

test('refuses an unknown action when the route is set up, not on the first request', () => {
  expect(() => audit('transaction.refund')).toThrow(/unknown audit action/i);
});

test('records one row after the response is sent', async () => {
  const app = appWith([audit('auth.login')], reply(200));
  await request(app).post('/x').send({ email: 'a@x.com', password: 'secret123' });

  expect(service.record).toHaveBeenCalledTimes(1);
  expect(service.record).toHaveBeenCalledWith({
    userId: null,
    action: 'auth.login',
    outcome: 'success',
    statusCode: 200,
    ipAddress: expect.any(String),
    metadata: { email: 'a@x.com' },
  });
});

test('never puts the password in what it records', async () => {
  const app = appWith([audit('auth.login')], reply(200));
  await request(app).post('/x').send({ email: 'a@x.com', password: 'secret123' });

  expect(JSON.stringify(service.record.mock.calls)).not.toContain('secret123');
});

test.each([
  [400, 'failure'],
  [401, 'failure'],
  [404, 'failure'],
  [429, 'failure'],
  [500, 'failure'],
  [200, 'success'],
  [201, 'success'],
])('a %i response is recorded as %s', async (status, outcome) => {
  const app = appWith([audit('auth.login')], reply(status));
  await request(app).post('/x').send({});

  expect(service.record.mock.calls[0][0]).toMatchObject({ statusCode: status, outcome });
});

test('takes the user from res.locals.auditUserId when the handler sets it (login, register)', async () => {
  const app = appWith([audit('auth.login')], reply(200, { auditUserId: 'user-from-login' }));
  await request(app).post('/x').send({});

  expect(service.record.mock.calls[0][0].userId).toBe('user-from-login');
});

test('takes the user from req.user when the route is behind requireAuth', async () => {
  const fakeAuth = (req, res, next) => {
    req.user = { id: 'user-from-token' };
    next();
  };
  const app = appWith([fakeAuth, audit('transaction.deposit')], reply(200));
  await request(app).post('/x').send({ accountId: 'acc-1', amount: 100 });

  expect(service.record.mock.calls[0][0]).toMatchObject({
    userId: 'user-from-token',
    metadata: { accountId: 'acc-1', amount: 100 },
  });
});

test('still records requests that are stopped by a later middleware', async () => {
  const stopper = (req, res) => res.status(429).json({ error: 'slow down' });
  const app = appWith([audit('auth.login'), stopper], reply(200));
  await request(app).post('/x').send({ email: 'a@x.com' });

  expect(service.record.mock.calls[0][0]).toMatchObject({ statusCode: 429, outcome: 'failure' });
});

test('does not record anything before the response has finished', async () => {
  let recordedWhileHandling;
  const app = appWith([audit('auth.login')], (req, res) => {
    recordedWhileHandling = service.record.mock.calls.length;
    res.json({});
  });
  await request(app).post('/x').send({});

  expect(recordedWhileHandling).toBe(0);
  expect(service.record).toHaveBeenCalledTimes(1);
});

test('if building the entry throws, the request still succeeds and the problem is logged', async () => {
  service.record.mockImplementation(() => {
    throw new Error('cannot build entry');
  });
  const app = appWith([audit('auth.login')], reply(200));
  const res = await request(app).post('/x').send({});

  expect(res.status).toBe(200);
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'auth.login' }),
    expect.stringMatching(/could not be built/)
  );
});
