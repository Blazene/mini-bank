const { querySchema, idSchema } = require('../monitoring.schema');

test('defaults to 20 rows and strips unknown filters', () => {
  expect(querySchema.parse({ role: 'admin', userId: 'other' })).toEqual({ limit: 20 });
});
test.each([
  { limit: '0' },
  { limit: '101' },
  { limit: '-1' },
  { limit: '1.5' },
  { limit: ['1', '2'] },
  { ruleCode: 'anything' },
  { ruleCode: ['LARGE_TRANSACTION', 'RAPID_TRANSFERS'] },
  { severity: 'low' },
  { accountId: 'not-a-uuid' },
  { transactionId: 'bad' },
  { cursor: 'bad' },
  { cursor: 'x'.repeat(301) },
  { from: '2026-02-30T00:00:00Z' },
  { from: '0000-01-01T00:00:00Z' },
  { to: '2026-10-01' },
  { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' },
])('rejects invalid query %p', (query) => {
  expect(querySchema.safeParse(query).success).toBe(false);
});
test('accepts filters and normalizes limit and zoned dates', () => {
  const result = querySchema.parse({
    ruleCode: 'RAPID_TRANSFERS',
    severity: 'high',
    limit: '100',
    from: '2026-10-25T00:00:00+05:30',
  });
  expect(result.limit).toBe(100);
  expect(result.from.toISOString()).toBe('2026-10-24T18:30:00.000Z');
});
test('detail id must be a UUID', () => {
  expect(idSchema.safeParse({ id: 'bad' }).success).toBe(false);
});
