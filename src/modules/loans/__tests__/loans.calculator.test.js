const { calculateSchedule } = require('../loans.calculator');

test('matches a known reducing-balance EMI (Rs 1 lakh, 12%, 12 months)', () => {
  const result = calculateSchedule(10_000_000, 1200, 12);
  expect(result.emi).toBe(888488);
  expect(result.schedule[0]).toEqual({
    month: 1,
    payment: 888488,
    principal: 788488,
    interest: 100000,
    balance: 9211512,
  });
});

test('zero interest divides principal and adjusts the last payment', () => {
  expect(calculateSchedule(100, 0, 3)).toEqual({
    emi: 33,
    totalInterest: 0,
    totalRepayment: 100,
    schedule: [
      { month: 1, payment: 33, principal: 33, interest: 0, balance: 67 },
      { month: 2, payment: 33, principal: 33, interest: 0, balance: 34 },
      { month: 3, payment: 34, principal: 34, interest: 0, balance: 0 },
    ],
  });
});

test('rounds exactly half a paise upward for EMI and monthly interest', () => {
  expect(calculateSchedule(101, 0, 2).emi).toBe(51);
  expect(calculateSchedule(100050, 1200, 6).schedule[0].interest).toBe(1001);
});

test.each([0, 1, 1200, 10000])('reconciles schedules at %i basis points', (rate) => {
  for (const principal of [1, 100001, 10000000, 100000000]) {
    for (const months of [1, 6, 12, 60, 360]) {
      const result = calculateSchedule(principal, rate, months);
      expect(result.schedule).toHaveLength(months);
      let balance = principal;
      let principalSum = 0;
      let interestSum = 0;
      let paymentSum = 0;
      for (const row of result.schedule) {
        expect(Object.values(row).every(Number.isSafeInteger)).toBe(true);
        expect(row.month).toBeGreaterThan(0);
        expect(row.balance).toBeGreaterThanOrEqual(0);
        expect(row.principal).toBeGreaterThanOrEqual(0);
        expect(row.interest).toBe(Math.floor((balance * rate + 60000) / 120000));
        expect(row.payment).toBe(row.principal + row.interest);
        expect(row.balance).toBe(balance - row.principal);
        balance = row.balance;
        principalSum += row.principal;
        interestSum += row.interest;
        paymentSum += row.payment;
      }
      expect(balance).toBe(0);
      expect(principalSum).toBe(principal);
      expect(interestSum).toBe(result.totalInterest);
      expect(paymentSum).toBe(result.totalRepayment);
      expect(paymentSum).toBe(principal + interestSum);
    }
  }
});

test.each([
  [0, 1200, 12],
  [-1, 1200, 12],
  [1.5, 1200, 12],
  ['100', 1200, 12],
  [100000001, 1200, 12],
  [100, -1, 12],
  [100, 10001, 12],
  [100, 1.5, 12],
  [100, 1200, 0],
  [100, 1200, 361],
  [100, 1200, 1.5],
  [NaN, 1200, 12],
  [Infinity, 1200, 12],
])('refuses unsupported calculation inputs %p %p %p', (p, rate, months) => {
  expect(() => calculateSchedule(p, rate, months)).toThrow(RangeError);
});
