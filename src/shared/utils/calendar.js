// True when the text starts with a real calendar date (YYYY-MM-DD).
// A regular expression accepts 2026-02-30, and so does new Date(), which quietly turns it into
// 2 March. PostgreSQL would instead refuse it with an error, which would surface as a 500.
// So we build the date and check that every part came back unchanged.
function isRealCalendarDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return false;

  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1) return false;

  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day); // setUTCFullYear avoids the 0-99 means 1900s rule
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

module.exports = { isRealCalendarDate };
