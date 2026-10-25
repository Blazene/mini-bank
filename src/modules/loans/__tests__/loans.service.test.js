const { quote } = require('../loans.service');

const input = { principal: 100000, tenureMonths: 12, monthlyIncome: 1500000 };

test('returns a quote using only the server policy', () => {
  const result = quote({ ...input, annualRateBps: 0, eligible: false });
  expect(result).toMatchObject({
    principal: input.principal,
    tenureMonths: 12,
    annualRateBps: 1200,
    currency: 'INR',
    eligibility: { eligible: true, reasons: [], maxMonthlyDebt: 600000 },
  });
});

test('minimum income is inclusive and one paise below fails', () => {
  expect(quote(input).eligibility.eligible).toBe(true);
  expect(quote({ ...input, monthlyIncome: 1499999 }).eligibility.reasons).toEqual([
    'INCOME_BELOW_MINIMUM',
  ]);
});

test('40% debt ceiling includes existing debt and the adjusted final payment', () => {
  const roundingInput = { ...input, principal: 100002 };
  const base = quote(roundingInput);
  const highest = Math.max(...base.schedule.map((row) => row.payment));
  expect(highest).toBeGreaterThan(base.emi);
  const atLimit = { ...roundingInput, existingMonthlyEmi: 600000 - highest };
  expect(quote(atLimit).eligibility.eligible).toBe(true);
  expect(
    quote({ ...atLimit, existingMonthlyEmi: atLimit.existingMonthlyEmi + 1 }).eligibility.reasons
  ).toEqual(['DEBT_TO_INCOME_EXCEEDED']);
});

test('floors a fractional-paise income allowance', () => {
  expect(quote({ ...input, monthlyIncome: 1500001 }).eligibility.maxMonthlyDebt).toBe(600000);
});

test('reports both eligibility failures without refusing to calculate', () => {
  const result = quote({ ...input, monthlyIncome: 100000, existingMonthlyEmi: 100000 });
  expect(result.eligibility).toMatchObject({
    eligible: false,
    reasons: ['INCOME_BELOW_MINIMUM', 'DEBT_TO_INCOME_EXCEEDED'],
  });
  expect(result.schedule).toHaveLength(12);
});

test('also validates direct service calls', () => {
  expect(() => quote({ ...input, principal: -1 })).toThrow();
});
