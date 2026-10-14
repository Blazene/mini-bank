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
