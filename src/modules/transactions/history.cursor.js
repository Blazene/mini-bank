const { isRealCalendarDate } = require('../../shared/utils/calendar');

// A cursor says "continue after this row". It holds the created_at and id of the LAST row of
// the page just sent, packed as base64url JSON so clients treat it as an opaque token.
//
// created_at is kept as TEXT with all six microsecond digits. PostgreSQL stores microseconds
// but a JavaScript Date only holds milliseconds, so a Date would round the timestamp and the
// next page could skip or repeat rows that differ only in the last three digits.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor({ createdAt, id }) {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id })).toString('base64url');
}

// Returns { createdAt, id }, or null for anything that is not a cursor WE could have issued.
// A client can send any text, so every part is checked before it reaches the database.
function decodeCursor(text) {
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    const ok =
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.t === 'string' &&
      typeof parsed.i === 'string' &&
      TIMESTAMP.test(parsed.t) &&
      isRealCalendarDate(parsed.t) &&
      UUID.test(parsed.i);
    return ok ? { createdAt: parsed.t, id: parsed.i } : null;
  } catch {
    return null;
  }
}

module.exports = { encodeCursor, decodeCursor };
