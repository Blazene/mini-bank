const { evaluate, LARGE_AMOUNT_PAISE, TRANSFER_COUNT } = require('../monitoring.rules');
const transaction = { status: 'completed', type: 'deposit', amount: 100 };

test('policy constants are explicit integer paise/counts', () => {
  expect(LARGE_AMOUNT_PAISE).toBe(10000000);
  expect(TRANSFER_COUNT).toBe(5);
});
test.each(['deposit', 'withdrawal', 'transfer'])('large %s threshold is inclusive', (type) => {
  expect(evaluate({ ...transaction, type, amount: LARGE_AMOUNT_PAISE - 1 })).toEqual([]);
  expect(evaluate({ ...transaction, type, amount: LARGE_AMOUNT_PAISE })).toEqual([
    {
      ruleCode: 'LARGE_TRANSACTION',
      severity: 'medium',
      details: { amount: LARGE_AMOUNT_PAISE, thresholdPaise: LARGE_AMOUNT_PAISE, ruleVersion: 1 },
    },
  ]);
  expect(evaluate({ ...transaction, type, amount: LARGE_AMOUNT_PAISE + 1 })).toHaveLength(1);
});
test.each(['pending', 'failed'])('ignores %s ledger rows', (status) => {
  expect(
    evaluate({ ...transaction, status, type: 'transfer', amount: LARGE_AMOUNT_PAISE }, 5)
  ).toEqual([]);
});
test('flags fifth and subsequent transfers but not the fourth', () => {
  expect(evaluate({ ...transaction, type: 'transfer' }, 4)).toEqual([]);
  expect(evaluate({ ...transaction, type: 'transfer' }, 5)[0]).toEqual({
    ruleCode: 'RAPID_TRANSFERS',
    severity: 'high',
    details: { countAtLeast: 5, windowSeconds: 300, ruleVersion: 1 },
  });
  expect(evaluate({ ...transaction, type: 'transfer' }, 6)).toHaveLength(1);
});
test.each(['deposit', 'withdrawal'])('velocity does not apply to %s', (type) => {
  expect(evaluate({ ...transaction, type }, 5)).toEqual([]);
});
test('one transfer can match two independent rules', () => {
  expect(
    evaluate({ ...transaction, type: 'transfer', amount: LARGE_AMOUNT_PAISE }, 5).map(
      (alert) => alert.ruleCode
    )
  ).toEqual(['LARGE_TRANSACTION', 'RAPID_TRANSFERS']);
});
