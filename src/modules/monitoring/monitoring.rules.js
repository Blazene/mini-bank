const LARGE_AMOUNT_PAISE = 10_000_000; // Rs 1 lakh, inclusive.
const TRANSFER_COUNT = 5;

function evaluate(transaction, transferCount = 0) {
  if (transaction.status !== 'completed') return [];
  const alerts = [];
  if (transaction.amount >= LARGE_AMOUNT_PAISE) {
    alerts.push({
      ruleCode: 'LARGE_TRANSACTION',
      severity: 'medium',
      details: { amount: transaction.amount, thresholdPaise: LARGE_AMOUNT_PAISE, ruleVersion: 1 },
    });
  }
  if (transaction.type === 'transfer' && transferCount >= TRANSFER_COUNT) {
    alerts.push({
      ruleCode: 'RAPID_TRANSFERS',
      severity: 'high',
      details: { countAtLeast: TRANSFER_COUNT, windowSeconds: 300, ruleVersion: 1 },
    });
  }
  return alerts;
}

module.exports = { evaluate, LARGE_AMOUNT_PAISE, TRANSFER_COUNT };
