const requireIdempotencyKey = require('../idempotencyKey');

function run(headers) {
  const req = { headers };
  const next = jest.fn();
  requireIdempotencyKey(req, {}, next);
  return { req, error: next.mock.calls[0][0] };
}

test('rejects a request with no Idempotency-Key header', () => {
  const { error } = run({});

  expect(error.statusCode).toBe(400);
  expect(error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
});

test.each([
  ['empty', ''],
  ['too short', 'abc123'],
  ['too long', 'a'.repeat(101)],
  ['containing spaces', 'has some spaces in it'],
  ['containing a slash', 'abc/def/ghi/jkl'],
  ['a repeated header joined with a comma', 'aaaaaaaa, bbbbbbbb'],
])('rejects a key that is %s', (label, key) => {
  const { error } = run({ 'idempotency-key': key });

  expect(error.statusCode).toBe(400);
  expect(error.code).toBe('INVALID_IDEMPOTENCY_KEY');
});

test.each([
  ['a UUID', '3f2b8c1e-6a4d-4b7e-9c1a-2d5e8f0a1b3c'],
  ['letters, dots, colons and underscores', 'order_42:retry.1'],
  ['the shortest allowed key', 'abcdefgh'],
  ['the longest allowed key', 'a'.repeat(100)],
])('accepts %s and attaches it to the request', (label, key) => {
  const { req, error } = run({ 'idempotency-key': key });

  expect(error).toBeUndefined();
  expect(req.idempotencyKey).toBe(key);
});
