const { quoteSchema } = require('../loans.schema');

const valid = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };

test('defaults existing debt and drops client-controlled rate, role and eligibility', () => {
  expect(quoteSchema.parse({ ...valid, annualRateBps: 0, eligible: true, role: 'admin' })).toEqual({
    ...valid,
    existingMonthlyEmi: 0,
  });
});

test.each([
  ['principal', 99999],
  ['principal', 100000001],
  ['principal', '100000'],
  ['principal', 100000.5],
  ['principal', null],
  ['principal', undefined],
  ['principal', NaN],
  ['principal', Infinity],
  ['tenureMonths', 5],
  ['tenureMonths', 361],
  ['tenureMonths', 12.5],
  ['tenureMonths', '12'],
  ['tenureMonths', undefined],
  ['monthlyIncome', 0],
  ['monthlyIncome', -1],
  ['monthlyIncome', 1.5],
  ['monthlyIncome', '5000000'],
  ['monthlyIncome', undefined],
  ['monthlyIncome', 100000001],
  ['existingMonthlyEmi', -1],
  ['existingMonthlyEmi', 1.5],
  ['existingMonthlyEmi', '0'],
  ['existingMonthlyEmi', 100000001],
])('rejects invalid %s: %p', (field, value) => {
  const result = quoteSchema.safeParse({ ...valid, [field]: value });
  expect(result.success).toBe(false);
  expect(result.error.issues.map((issue) => issue.path[0])).toContain(field);
});

test.each([6, 360])('accepts tenure boundary %i', (tenureMonths) => {
  expect(quoteSchema.safeParse({ ...valid, tenureMonths }).success).toBe(true);
});

test.each([100000, 100000000])('accepts principal boundary %i', (principal) => {
  expect(quoteSchema.safeParse({ ...valid, principal }).success).toBe(true);
});
