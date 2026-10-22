const db = require('../../config/db');
const { COLUMNS, toTransaction } = require('./transactions.repository');

// One page of the ledger, newest first, for a given list of account ids.
//
// SCOPING: a row qualifies only if the money went out of, or came into, one of accountIds.
// The service builds that list from the caller's OWN accounts, so this query can never return a
// row that touches only other people's accounts. A transfer between two people qualifies for
// both of them because it matches on either side.
//
// ORDER: created_at DESC, then id DESC. Two rows can share a timestamp, and without a final
// tie-breaker their order is undefined, so a row could be skipped or repeated across pages.
//
// KEYSET: the cursor row-comparison (created_at, id) < (cursor) means "strictly after the
// cursor row in this ordering". Unlike OFFSET it never re-reads earlier rows, and rows inserted
// at the top between two requests cannot shift the next page.
//
// Every value reaches the database as a parameter. Only fixed SQL text is concatenated.
async function findPage(accountIds, { type, from, to, cursor, limit }) {
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const ids = param(accountIds);
  const where = [`(from_account_id = ANY(${ids}::uuid[]) OR to_account_id = ANY(${ids}::uuid[]))`];
  if (type) where.push(`type = ${param(type)}`);
  if (from) where.push(`created_at >= ${param(from)}`);
  if (to) where.push(`created_at < ${param(to)}`);
  if (cursor) {
    where.push(
      `(created_at, id) < (${param(cursor.createdAt)}::timestamptz, ${param(cursor.id)}::uuid)`
    );
  }

  // cursor_ts is created_at as text with all six microsecond digits, for the next cursor.
  const { rows } = await db.query(
    `SELECT ${COLUMNS},
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
     FROM transactions
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT ${param(limit)}`,
    params
  );
  return rows.map((row) => ({ ...toTransaction(row), cursorTs: row.cursor_ts }));
}

module.exports = { findPage };
