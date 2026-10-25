const AppError = require('../AppError');

test('defaults to a server error with a machine-readable code and no details', () => {
  const error = new AppError('Internal failure');
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('Internal failure');
  expect(error.statusCode).toBe(500);
  expect(error.code).toBe('INTERNAL_ERROR');
  expect(error.details).toBeUndefined();
});

test('keeps explicit status, code and validation details', () => {
  const details = [{ field: 'amount', message: 'Invalid' }];
  expect(new AppError('Invalid data', 400, 'VALIDATION_ERROR', details)).toMatchObject({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    details,
  });
});
