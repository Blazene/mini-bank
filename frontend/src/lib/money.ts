export function parseRupees(text: string, { max = 1_000_000_000, allowZero = false } = {}): number {
  const value = text.trim();
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(value))
    throw new Error('Enter a rupee amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise < (allowZero ? 0n : 1n) || paise > BigInt(max))
    throw new Error(
      `Amount must be ${allowZero ? 'zero or more' : 'greater than zero'} and no more than ${formatMoney(max)}.`
    );
  return Number(paise);
}
export function formatMoney(value: number | bigint): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Invalid paise amount.');
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  return `${n < 0n ? '−' : ''}₹${new Intl.NumberFormat('en-IN').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const totalBalance = (accounts: { balance: number }[]) =>
  accounts.reduce((sum, account) => sum + BigInt(account.balance), 0n);
export function displayDate(value: string, short = false) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(short ? {} : { year: 'numeric' }),
  }).format(new Date(value));
}
