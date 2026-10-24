const { auditLogsQuerySchema: schema } = require('../audit.schema');
const { encodeCursor } = require('../../transactions/history.cursor');

const UUID = '11111111-1111-4111-8111-111111111111';
const fieldsOf = (result) => result.error.issues.map((issue) => issue.path.join('.'));

test('an empty query is fine and gets the default limit of 20', () => {
  expect(schema.parse({})).toEqual({ limit: 20 });
});

test.each([
  'auth.register',
  'auth.login',
  'transaction.deposit',
  'transaction.withdraw',
  'transaction.transfer',
  'admin.role_granted',
])('accepts the action %s', (action) => {
  expect(schema.parse({ action }).action).toBe(action);
});

test.each(['login', 'AUTH.LOGIN', 'auth.', '', 'transaction.refund'])(
  'refuses the action %p',
  (action) => {
    const result = schema.safeParse({ action });
    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toEqual(['action']);
  }
);

test.each(['success', 'failure'])('accepts the outcome %s', (outcome) => {
  expect(schema.parse({ outcome }).outcome).toBe(outcome);
});

test.each(['ok', 'SUCCESS', '', 'error'])('refuses the outcome %p', (outcome) => {
  expect(schema.safeParse({ outcome }).success).toBe(false);
});

test('userId must be a UUID', () => {
  expect(schema.parse({ userId: UUID }).userId).toBe(UUID);
  expect(schema.safeParse({ userId: 'someone' }).success).toBe(false);
});

test('dates, limit and cursor follow the same rules as the transaction history', () => {
  const query = schema.parse({
    from: '2026-10-01T00:00:00+05:30',
    to: '2026-10-02T00:00:00Z',
    limit: '50',
    cursor: encodeCursor({ createdAt: '2026-10-22T10:47:38.534123Z', id: UUID }),
  });
  expect(query.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  expect(query.limit).toBe(50);
  expect(query.cursor).toEqual({ createdAt: '2026-10-22T10:47:38.534123Z', id: UUID });

  expect(schema.safeParse({ limit: '101' }).success).toBe(false);
  expect(schema.safeParse({ from: '2026-10-01' }).success).toBe(false);
  expect(schema.safeParse({ from: '2026-02-30T00:00:00Z' }).success).toBe(false);
  expect(schema.safeParse({ cursor: 'garbage' }).success).toBe(false);
  expect(
    schema.safeParse({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }).success
  ).toBe(false);
});

test('unknown parameters are dropped', () => {
  expect(schema.parse({ role: 'admin', limit: '5' })).toEqual({ limit: 5 });
});
