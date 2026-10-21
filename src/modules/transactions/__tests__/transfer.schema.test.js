const { transferSchema, MAX_AMOUNT_PAISE } = require('../transactions.schema');

const fromAccountId = '11111111-1111-4111-8111-111111111111';
const valid = { fromAccountId, toAccountNumber: '123456789012', amount: 2500 };
const parse = (overrides) => transferSchema.safeParse({ ...valid, ...overrides });

test('accepts a valid transfer and drops unknown fields', () => {
  const result = parse({ description: ' rent ', balance: 999, userId: 'someone-else' });

  expect(result.success).toBe(true);
  expect(result.data).toEqual({ ...valid, description: 'rent' });
});

test('accepts the largest allowed amount', () => {
  expect(parse({ amount: MAX_AMOUNT_PAISE }).success).toBe(true);
});

test('rejects a source account id that is not a UUID', () => {
  expect(parse({ fromAccountId: '123' }).success).toBe(false);
});

test.each([
  ['too short', '12345678901'],
  ['too long', '1234567890123'],
  ['containing a letter', '12345678901a'],
  ['starting with zero', '012345678901'],
  ['padded with a space', ' 123456789012'],
  ['a number instead of text', 123456789012],
  ['missing', undefined],
])('rejects a destination account number that is %s', (label, toAccountNumber) => {
  expect(parse({ toAccountNumber }).success).toBe(false);
});

test.each([
  ['zero', 0],
  ['negative', -5],
  ['a decimal', 10.5],
  ['a string', '100'],
  ['above the cap', MAX_AMOUNT_PAISE + 1],
  ['missing', undefined],
])('rejects an amount that is %s', (label, amount) => {
  expect(parse({ amount }).success).toBe(false);
});

test('rejects a description longer than 140 characters', () => {
  expect(parse({ description: 'x'.repeat(141) }).success).toBe(false);
});
