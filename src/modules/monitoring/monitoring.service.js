const AppError = require('../../shared/utils/AppError');
const users = require('../auth/auth.repository');
const transactions = require('../transactions/transactions.repository');
const { encodeCursor } = require('../../shared/utils/pagination.cursor');
const { evaluate } = require('./monitoring.rules');
const repository = require('./monitoring.repository');

// Called only for a newly inserted ledger row, using its transaction client while
// account locks are held. Do not catch errors: roll back money AND alerts together.
async function record(client, transaction) {
  if (transaction.status !== 'completed') return;
  const count =
    transaction.type === 'transfer'
      ? await transactions.countRecentOutgoingTransfers(
          client,
          transaction.fromAccountId,
          transaction.id
        )
      : 0;
  for (const alert of evaluate(transaction, count))
    await repository.insert(client, transaction, alert);
}

async function assertCurrentAdmin(userId) {
  const user = await users.findById(userId);
  if (!user) throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  if (user.role !== 'admin') throw new AppError('Admin access required', 403, 'FORBIDDEN');
}

async function list(adminId, query) {
  await assertCurrentAdmin(adminId);
  const rows = await repository.findPage({ ...query, limit: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    alerts: page.map(({ cursorTs: _cursorTs, ...row }) => row),
    pagination: {
      limit: query.limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor({ createdAt: last.cursorTs, id: last.id }) : null,
    },
  };
}

async function get(adminId, id) {
  await assertCurrentAdmin(adminId);
  const alert = await repository.findById(id);
  if (!alert) throw new AppError('Monitoring alert not found', 404, 'ALERT_NOT_FOUND');
  return alert;
}

module.exports = { record, list, get };
