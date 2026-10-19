const { paiseToNumber } = require('../money');

test('converts the string pg returns for a BIGINT into a number', () => {
  expect(paiseToNumber('150050')).toBe(150050);
  expect(paiseToNumber('0')).toBe(0);
});

test('accepts the largest exactly representable amount', () => {
  expect(paiseToNumber('9007199254740991')).toBe(9007199254740991);
});

test('refuses an amount a JavaScript number cannot hold exactly', () => {
  expect(() => paiseToNumber('9007199254740993')).toThrow('cannot be represented exactly');
});
