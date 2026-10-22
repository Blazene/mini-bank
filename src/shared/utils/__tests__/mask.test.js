const { maskAccountNumber } = require('../mask');

test('keeps only the last four digits of a 12-digit account number', () => {
  expect(maskAccountNumber('123456789012')).toBe('XXXXXXXX9012');
});

test('keeps the length of the original so it looks like an account number', () => {
  expect(maskAccountNumber('123456789012')).toHaveLength(12);
});

test('never reveals more than four characters, even for short input', () => {
  expect(maskAccountNumber('1234')).toBe('1234');
  expect(maskAccountNumber('12')).toBe('12');
});
