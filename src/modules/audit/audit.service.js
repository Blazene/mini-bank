const logger = require('../../shared/utils/logger');
const repository = require('./audit.repository');
const { encodeCursor } = require('../../shared/utils/pagination.cursor');

// Writes that have been started but not finished. Kept so that tests, and a clean shutdown,
// can wait until every audit row has really been saved.
const pending = new Set();

// Saves one audit row WITHOUT making the caller wait, and without ever throwing.
// The request has already been answered by the time this runs, so a logging problem must
// not turn a successful transfer into an error. A failed write is reported to the server log.
// Trade-off: if the process dies between the answer and the write, that row is lost. A design
// that cannot lose rows writes the audit row inside the same database transaction as the
// money movement.
function record(entry) {
  const write = repository
    .insert(entry)
    .catch((err) => {
      logger.error({ err, action: entry.action }, 'audit log write failed');
    })
    .finally(() => pending.delete(write));
  pending.add(write);
}

async function flushAuditWrites() {
  await Promise.allSettled([...pending]);
}

async function listLogs({ action, outcome, userId, from, to, cursor, limit }) {
  // One row more than the page tells us whether another page exists (no COUNT query).
  const rows = await repository.findPage({
    action,
    outcome,
    userId,
    from,
    to,
    cursor,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    logs: pageRows.map(({ cursorTs: _cursorTs, ...entry }) => entry),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor({ createdAt: last.cursorTs, id: last.id }) : null,
    },
  };
}

module.exports = { record, flushAuditWrites, listLogs };
