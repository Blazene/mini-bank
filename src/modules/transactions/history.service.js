const AppError = require('../../shared/utils/AppError');
const { maskAccountNumber } = require('../../shared/utils/mask');
const accountsRepository = require('../accounts/accounts.repository');
const historyRepository = require('./history.repository');
const { encodeCursor } = require('./history.cursor');

// Turns one ledger row into what the caller is allowed to see.
//   viewIds  = the accounts we are looking at (all of the caller's, or the one they filtered by)
//   ownedIds = all of the caller's accounts
// direction is from the viewer's side: credit (money in), debit (money out), or internal
// (between two of the viewed accounts). The other party is shown only as a MASKED account
// number. Another person's account id is never returned: nobody can see anyone else's id.
function present(row, viewIds, ownedIds, numbers) {
  const fromViewed = viewIds.has(row.fromAccountId);
  const toViewed = viewIds.has(row.toAccountId);
  const direction = fromViewed && toViewed ? 'internal' : fromViewed ? 'debit' : 'credit';

  const otherId = [row.fromAccountId, row.toAccountId].find((id) => id && !viewIds.has(id));

  return {
    id: row.id,
    type: row.type,
    direction,
    amount: row.amount,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt,
    fromAccountId: ownedIds.has(row.fromAccountId) ? row.fromAccountId : null,
    toAccountId: ownedIds.has(row.toAccountId) ? row.toAccountId : null,
    counterpartyAccountNumber: otherId ? maskAccountNumber(numbers.get(otherId)) : null,
  };
}

async function listHistory(userId, { accountId, type, from, to, cursor, limit }) {
  // The set of accounts the caller may look at comes from the database, by owner. Everything
  // below is restricted to it, so a forged filter or cursor cannot reach anyone else's rows.
  const accounts = await accountsRepository.findAllByUser(userId);
  const ownedIds = new Set(accounts.map((account) => account.id));

  let viewIds = ownedIds;
  if (accountId) {
    const wanted = accountId.toLowerCase(); // ids are stored in lower case
    if (!ownedIds.has(wanted)) {
      // Same 404 as a missing account, so this cannot be used to find out which ids exist.
      throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
    }
    viewIds = new Set([wanted]);
  }

  const empty = { transactions: [], pagination: { limit, hasMore: false, nextCursor: null } };
  if (viewIds.size === 0) return empty;

  // Ask for one row more than the page. If it arrives, there is another page, and it is
  // dropped. This avoids a second COUNT query and never says "more" when there is none.
  const rows = await historyRepository.findPage([...viewIds], {
    type,
    from,
    to,
    cursor,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // One batched lookup for the other parties' numbers, not one query per row.
  const otherIds = new Set(
    pageRows
      .flatMap((row) => [row.fromAccountId, row.toAccountId])
      .filter((id) => id && !viewIds.has(id))
  );
  const numbers = await accountsRepository.findAccountNumbersByIds([...otherIds]);

  const last = pageRows[pageRows.length - 1];
  return {
    transactions: pageRows.map((row) => present(row, viewIds, ownedIds, numbers)),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor({ createdAt: last.cursorTs, id: last.id }) : null,
    },
  };
}

module.exports = { listHistory };
