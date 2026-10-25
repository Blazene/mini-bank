const { isRealCalendarDate } = require('./calendar');

// Preserve PostgreSQL microseconds; JavaScript Date would round the cursor position.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor({ createdAt, id }) {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id })).toString('base64url');
}

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
