const { moneyMovementSchema, MAX_AMOUNT_PAISE } = require('../transactions.schema');

const accountId = '11111111-1111-4111-8111-111111111111';
const parse = (body) => moneyMovementSchema.safeParse(body);

test('accepts a valid body and drops unknown fields', () => {
  const result = parse({ accountId, amount: 2500, description: ' salary ', balance: 999 });

  expect(result.success).toBe(true);
  expect(result.data).toEqual({ accountId, amount: 2500, description: 'salary' });
});

test('accepts the largest allowed amount', () => {
  expect(parse({ accountId, amount: MAX_AMOUNT_PAISE }).success).toBe(true);
});

test.each([
  ['zero', 0],
  ['negative', -5],
  ['a decimal', 10.5],
  ['a string', '100'],
  ['above the cap', MAX_AMOUNT_PAISE + 1],
  ['null', null],
  ['missing', undefined],
])('rejects an amount that is %s', (label, amount) => {
  expect(parse({ accountId, amount }).success).toBe(false);
});

test('rejects an account id that is not a UUID', () => {
  expect(parse({ accountId: '123', amount: 100 }).success).toBe(false);
});

test('rejects a description longer than 140 characters', () => {
  expect(parse({ accountId, amount: 100, description: 'x'.repeat(141) }).success).toBe(false);
});
