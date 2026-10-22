const { isRealCalendarDate } = require('../calendar');

test.each(['2026-10-22', '2024-02-29', '2026-12-31T23:59:59.123456Z', '0001-01-01'])(
  'accepts the real date %s',
  (text) => {
    expect(isRealCalendarDate(text)).toBe(true);
  }
);

test.each([
  ['a day that never exists', '2026-02-30'],
  ['29 February in a non-leap year', '2025-02-29'],
  ['31 April', '2026-04-31'],
  ['month 13', '2026-13-01'],
  ['day 00', '2026-10-00'],
  ['year 0000, which PostgreSQL refuses', '0000-06-15'],
  ['text that is not a date', 'tomorrow'],
])('refuses %s', (_label, text) => {
  expect(isRealCalendarDate(text)).toBe(false);
});
