const {
  listTransactionsQuerySchema: listSchema,
  accountTransactionsQuerySchema: accountSchema,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../history.schema');
const { encodeCursor } = require('../history.cursor');

const UUID = '11111111-1111-4111-8111-111111111111';
const validCursor = encodeCursor({ createdAt: '2026-10-22T10:47:38.534123Z', id: UUID });

const fieldsOf = (result) => result.error.issues.map((issue) => issue.path.join('.'));

describe('limit', () => {
  test('defaults to 20 when missing', () => {
    expect(DEFAULT_LIMIT).toBe(20);
    expect(listSchema.parse({}).limit).toBe(20);
  });

  test('is converted from text to a number', () => {
    expect(listSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  test('accepts the smallest and largest allowed values', () => {
    expect(listSchema.parse({ limit: '1' }).limit).toBe(1);
    expect(listSchema.parse({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
  });

  test.each(['0', '101', '1000', '-5', '1.5', 'abc', '', '1e2', ' 5', '99999999999999999999'])(
    'refuses %p instead of quietly changing it',
    (limit) => {
      const result = listSchema.safeParse({ limit });
      expect(result.success).toBe(false);
      expect(fieldsOf(result)).toContain('limit');
    }
  );

  test('has a hard maximum of 100', () => {
    expect(MAX_LIMIT).toBe(100);
  });
});

describe('type', () => {
  test.each(['deposit', 'withdrawal', 'transfer'])('accepts %s', (type) => {
    expect(listSchema.parse({ type }).type).toBe(type);
  });

  test.each(['withdraw', 'DEPOSIT', '', 'transfer,deposit'])('refuses %p', (type) => {
    expect(listSchema.safeParse({ type }).success).toBe(false);
  });

  test('refuses a repeated parameter (it arrives as an array)', () => {
    expect(listSchema.safeParse({ type: ['deposit', 'transfer'] }).success).toBe(false);
  });
});

describe('from and to', () => {
  test('are turned into Date objects, with offsets converted to the same moment', () => {
    const query = listSchema.parse({
      from: '2026-10-01T00:00:00+05:30',
      to: '2026-10-02T00:00:00Z',
    });
    expect(query.from).toBeInstanceOf(Date);
    expect(query.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(query.to.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  test.each([
    ['a date with no time', '2026-10-01'],
    ['a time with no zone', '2026-10-01T00:00:00'],
    ['a day that does not exist', '2026-02-30T00:00:00Z'],
    ['29 February in a non-leap year', '2025-02-29T00:00:00Z'],
    ['hour 24', '2026-10-01T24:00:00Z'],
    ['an impossible offset', '2026-10-01T00:00:00+99:99'],
    ['year 0000', '0000-01-01T00:00:00Z'],
    ['free text', 'yesterday'],
    ['a number', '1761130000'],
  ])('refuses %s', (_label, from) => {
    const result = listSchema.safeParse({ from });
    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toEqual(['from']);
  });

  test('shows one message per problem, not two', () => {
    const result = listSchema.safeParse({ from: '2026-02-30T00:00:00Z' });
    expect(result.error.issues).toHaveLength(1);
  });

  test('from must be earlier than to', () => {
    const result = listSchema.safeParse({
      from: '2026-10-02T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toEqual(['from']);
  });

  test('an empty range (from equal to to) is refused too', () => {
    const same = '2026-10-01T00:00:00Z';
    expect(listSchema.safeParse({ from: same, to: same }).success).toBe(false);
  });

  test('either one alone is fine', () => {
    expect(listSchema.safeParse({ from: '2026-10-01T00:00:00Z' }).success).toBe(true);
    expect(listSchema.safeParse({ to: '2026-10-01T00:00:00Z' }).success).toBe(true);
  });
});

describe('cursor', () => {
  test('a cursor we issued is decoded to { createdAt, id }', () => {
    expect(listSchema.parse({ cursor: validCursor }).cursor).toEqual({
      createdAt: '2026-10-22T10:47:38.534123Z',
      id: UUID,
    });
  });

  test.each(['garbage', '', 'a'.repeat(301)])('refuses %p', (cursor) => {
    const result = listSchema.safeParse({ cursor });
    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toContain('cursor');
  });
});

describe('accountId', () => {
  test('must be a UUID', () => {
    expect(listSchema.safeParse({ accountId: UUID }).success).toBe(true);
    expect(listSchema.safeParse({ accountId: 'ACC1' }).success).toBe(false);
  });

  test('is not a filter on the per-account route, where the path names the account', () => {
    expect(accountSchema.parse({ accountId: UUID }).accountId).toBeUndefined();
  });
});

test('unknown parameters are dropped, like unknown body fields', () => {
  expect(listSchema.parse({ userId: 'someone-else', role: 'admin' })).toEqual({ limit: 20 });
});

test('the per-account schema has the same limit, type, date and cursor rules', () => {
  expect(accountSchema.safeParse({ limit: '101' }).success).toBe(false);
  expect(accountSchema.safeParse({ type: 'nope' }).success).toBe(false);
  expect(accountSchema.safeParse({ from: 'x' }).success).toBe(false);
  expect(accountSchema.safeParse({ cursor: 'x' }).success).toBe(false);
  expect(
    accountSchema.safeParse({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }).success
  ).toBe(false);
});
