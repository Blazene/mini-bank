import { describe, expect, it } from 'vitest';
import { formatMoney, parseRupees, totalBalance } from './money';
describe('exact money', () => {
  it.each([
    ['0.01', 1],
    ['10.50', 1050],
    ['1000', 100000],
    [' 25.5 ', 2550],
    ['0001.05', 105],
  ])('parses %s into integer paise', (input, expected) =>
    expect(parseRupees(input)).toBe(expected)
  );
  it.each(['', '0', '-1', '1.001', '1e3', '1,000', 'NaN', '.5', 'Infinity', '10000000.01'])(
    'refuses invalid or over-limit amount %s',
    (input) => expect(() => parseRupees(input)).toThrow()
  );
  it('supports zero only for explicit zero-allowed fields', () =>
    expect(parseRupees('0', { allowZero: true })).toBe(0));
  it('formats large paise without floating-point lost cents', () =>
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe('₹9,00,71,99,25,47,409.91'));
  it('sums accounts using BigInt past the individual safe-integer limit', () =>
    expect(
      totalBalance([{ balance: Number.MAX_SAFE_INTEGER }, { balance: Number.MAX_SAFE_INTEGER }])
    ).toBe(18014398509481982n));
  it('formats sign and cents', () => {
    expect(formatMoney(-1050)).toBe('−₹10.50');
    expect(formatMoney(1)).toBe('₹0.01');
  });
  it('rejects fractional paise', () => expect(() => formatMoney(1.1)).toThrow());
});
