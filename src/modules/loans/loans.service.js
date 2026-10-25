const { quoteSchema } = require('./loans.schema');
const { calculateSchedule } = require('./loans.calculator');

const ANNUAL_RATE_BPS = 1200;
const MIN_MONTHLY_INCOME = 1_500_000; // Rs 15,000
const MAX_DEBT_PERCENT = 40;

function quote(input) {
  const { principal, tenureMonths, monthlyIncome, existingMonthlyEmi } = quoteSchema.parse(input);
  const calculation = calculateSchedule(principal, ANNUAL_RATE_BPS, tenureMonths);
  const maxMonthlyDebt = Math.floor((monthlyIncome * MAX_DEBT_PERCENT) / 100);
  // Include the adjusted final installment in affordability, not just the EMI.
  const highestPayment = Math.max(...calculation.schedule.map((row) => row.payment));
  const reasons = [];
  if (monthlyIncome < MIN_MONTHLY_INCOME) reasons.push('INCOME_BELOW_MINIMUM');
  if (existingMonthlyEmi + highestPayment > maxMonthlyDebt) {
    reasons.push('DEBT_TO_INCOME_EXCEEDED');
  }

  return {
    principal,
    tenureMonths,
    annualRateBps: ANNUAL_RATE_BPS,
    currency: 'INR',
    ...calculation,
    eligibility: { eligible: reasons.length === 0, reasons, maxMonthlyDebt },
  };
}

module.exports = { quote };
