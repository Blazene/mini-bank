const validate = require('../validate');
const { registerSchema } = require('../../../modules/auth/auth.schema');

test('calls next with a 400 VALIDATION_ERROR when the body is invalid', () => {
  const next = jest.fn();
  validate(registerSchema)({ body: {} }, {}, next);

  const err = next.mock.calls[0][0];
  expect(err.statusCode).toBe(400);
  expect(err.code).toBe('VALIDATION_ERROR');
  expect(err.details.length).toBeGreaterThan(0);
});

test('replaces req.body with cleaned data and calls next with no error', () => {
  const next = jest.fn();
  const req = {
    body: { email: ' A@X.com ', fullName: 'Anurag', password: 'secret123', role: 'admin' },
  };
  validate(registerSchema)(req, {}, next);

  expect(next).toHaveBeenCalledWith();
  expect(req.body.email).toBe('a@x.com');
  expect(req.body.role).toBeUndefined();
});

describe('validating a different part of the request', () => {
  const { accountIdParamsSchema } = require('../../../modules/accounts/accounts.schema');

  test('checks req.params when asked to, and fails with a 400', () => {
    const next = jest.fn();
    validate(accountIdParamsSchema, 'params')({ params: { id: 'nope' } }, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.details[0].field).toBe('id');
  });

  test('accepts valid params and leaves req.body alone', () => {
    const next = jest.fn();
    const id = '11111111-1111-4111-8111-111111111111';
    const req = { params: { id }, body: { keep: 'me' } };
    validate(accountIdParamsSchema, 'params')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params).toEqual({ id });
    expect(req.body).toEqual({ keep: 'me' });
  });
});

describe('validating the query string', () => {
  const express = require('express');
  const request = require('supertest');
  const { z } = require('zod');
  const schema = z.object({ limit: z.string().transform(Number).default(20) });

  // A real Express 5 app, because there req.query is a read-only getter on the request.
  const app = express();
  app.get('/x', validate(schema, 'query'), (req, res) => res.json({ query: req.query }));
  app.use((err, req, res, _next) => res.status(err.statusCode).json({ details: err.details }));

  test('hands the controller the CLEANED query, not the raw strings', async () => {
    const res = await request(app).get('/x?limit=7&junk=1');
    expect(res.body.query).toEqual({ limit: 7 });
  });

  test('fills in defaults when there is no query string at all', async () => {
    const res = await request(app).get('/x');
    expect(res.body.query).toEqual({ limit: 20 });
  });

  test('fails with a 400 and names the bad parameter', async () => {
    const strict = express();
    strict.get('/x', validate(z.object({ limit: z.enum(['a']) }), 'query'), (req, res) =>
      res.end()
    );
    strict.use((err, req, res, _next) => res.status(err.statusCode).json(err.details));

    const res = await request(strict).get('/x?limit=zzz');
    expect(res.status).toBe(400);
    expect(res.body[0].field).toBe('limit');
  });
});
