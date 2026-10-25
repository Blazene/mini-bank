// Annual rate is integer basis points: 1200 = 12%. Dividing by 120000 gives
// the monthly rate. BigInt rational arithmetic avoids floating-point money.
const MONTHLY_DENOMINATOR = 120_000n;
const roundHalfUp = (numerator, denominator) => (2n * numerator + denominator) / (2n * denominator);

function calculateSchedule(principal, annualRateBps, tenureMonths) {
  if (
    !Number.isSafeInteger(principal) ||
    principal <= 0 ||
    principal > 100_000_000 ||
    !Number.isInteger(annualRateBps) ||
    annualRateBps < 0 ||
    annualRateBps > 10_000 ||
    !Number.isInteger(tenureMonths) ||
    tenureMonths < 1 ||
    tenureMonths > 360
  ) {
    throw new RangeError('Loan calculation inputs are outside supported bounds');
  }

  const p = BigInt(principal);
  const rate = BigInt(annualRateBps);
  const d = MONTHLY_DENOMINATOR;
  const power = (d + rate) ** BigInt(tenureMonths);
  const emi =
    rate === 0n
      ? roundHalfUp(p, BigInt(tenureMonths))
      : roundHalfUp(p * rate * power, d * (power - d ** BigInt(tenureMonths)));

  let balance = p;
  let totalInterest = 0n;
  const schedule = [];
  for (let month = 1; month <= tenureMonths; month += 1) {
    const interest = roundHalfUp(balance * rate, d);
    // The last payment absorbs accumulated paise rounding. Cap earlier payments
    // at the remaining debt so a tiny balance can never become negative.
    const debt = balance + interest;
    const payment = month === tenureMonths || emi > debt ? debt : emi;
    const principalPaid = payment - interest;
    balance -= principalPaid;
    totalInterest += interest;
    schedule.push({
      month,
      payment: Number(payment),
      principal: Number(principalPaid),
      interest: Number(interest),
      balance: Number(balance),
    });
  }

  return {
    emi: Number(emi),
    totalInterest: Number(totalInterest),
    totalRepayment: Number(p + totalInterest),
    schedule,
  };
}

module.exports = { calculateSchedule };
