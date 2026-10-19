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
