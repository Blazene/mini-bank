const errorHandler = require('../errorHandler');
const AppError = require('../../utils/AppError');

function run(err) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  errorHandler(err, {}, res, jest.fn());
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

test('hides a database error code and message on a server error', () => {
  const dbError = Object.assign(
    new Error('new row violates check constraint "accounts_balance_check"'),
    {
      code: '23514',
      details: [{ secret: 'internal' }],
    }
  );
  const { status, body } = run(dbError);

  expect(status).toBe(500);
  expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
});

test('passes an AppError through with its own status, code and message', () => {
  const { status, body } = run(new AppError('Insufficient funds', 422, 'INSUFFICIENT_FUNDS'));

  expect(status).toBe(422);
  expect(body.error).toEqual({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' });
});

test('keeps validation details on a client error', () => {
  const details = [{ field: 'amount', message: 'Amount must be greater than zero' }];
  const { body } = run(new AppError('Invalid request data', 400, 'VALIDATION_ERROR', details));

  expect(body.error.details).toEqual(details);
});

test('a client error without a code still receives the machine-readable fallback', () => {
  const error = Object.assign(new Error('Bad input'), { statusCode: 400 });
  expect(run(error)).toEqual({
    status: 400,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Bad input' } },
  });
});
