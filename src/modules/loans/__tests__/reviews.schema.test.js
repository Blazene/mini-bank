const { reviewSchema } = require('../loans.schema');

test.each(['approved', 'rejected'])('accepts %s and trims a customer-facing reason', (decision) => {
  expect(
    reviewSchema.parse({ decision, reason: '  Documents have been reviewed  ', status: 'pending' })
  ).toEqual({ decision, reason: 'Documents have been reviewed' });
});

test.each([
  {},
  { decision: 'pending', reason: 'Documents reviewed' },
  { decision: 'approve', reason: 'Documents reviewed' },
  { decision: 'APPROVED', reason: 'Documents reviewed' },
  { decision: 'approved' },
  { decision: 'rejected', reason: null },
  { decision: 'approved', reason: ' '.repeat(20) },
  { decision: 'approved', reason: '123456789' },
  { decision: 'approved', reason: 'a'.repeat(501) },
  { decision: 'approved', reason: { secret: true } },
  { decision: 'approved', reason: '😀'.repeat(5) },
  { decision: 'approved', reason: '😀'.repeat(501) },
  { decision: 'approved', reason: 'Null byte here\u0000' },
  { decision: 'approved', reason: 'Lone surrogate \ud800' },
])('refuses malformed decision %p', (input) => {
  expect(reviewSchema.safeParse(input).success).toBe(false);
});

test.each([10, 500])('accepts reason length boundary %i', (length) => {
  expect(reviewSchema.safeParse({ decision: 'rejected', reason: 'a'.repeat(length) }).success).toBe(
    true
  );
});

test.each([10, 500])('counts Unicode reason boundaries like PostgreSQL (%i)', (length) => {
  expect(
    reviewSchema.safeParse({ decision: 'approved', reason: '😀'.repeat(length) }).success
  ).toBe(true);
});
