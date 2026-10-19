const { createAccountSchema, accountIdParamsSchema } = require('../accounts.schema');

describe('createAccountSchema', () => {
  test.each(['savings', 'current'])('accepts the %s account type', (type) => {
    const result = createAccountSchema.safeParse({ type });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ type });
  });

  test('rejects an unknown account type', () => {
    expect(createAccountSchema.safeParse({ type: 'premium' }).success).toBe(false);
  });

  test('rejects a missing account type', () => {
    expect(createAccountSchema.safeParse({}).success).toBe(false);
  });

  test('strips fields the client must not control', () => {
    const result = createAccountSchema.safeParse({
      type: 'savings',
      balance: 999999,
      status: 'closed',
      userId: 'someone-else',
      accountNumber: '000000000001',
    });

    expect(result.data).toEqual({ type: 'savings' });
  });
});

describe('accountIdParamsSchema', () => {
  test('accepts a UUID', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(accountIdParamsSchema.safeParse({ id }).success).toBe(true);
  });

  test('rejects an id that is not a UUID', () => {
    expect(accountIdParamsSchema.safeParse({ id: '123' }).success).toBe(false);
  });
});
