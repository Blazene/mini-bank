jest.mock('../monitoring.repository');
jest.mock('../../transactions/transactions.repository');
jest.mock('../../auth/auth.repository');
const repository = require('../monitoring.repository');
const transactions = require('../../transactions/transactions.repository');
const users = require('../../auth/auth.repository');
const service = require('../monitoring.service');
const { decodeCursor } = require('../../../shared/utils/pagination.cursor');

const client = { name: 'same-transaction-client' };
const tx = {
  id: 'tx',
  status: 'completed',
  type: 'transfer',
  amount: 10000000,
  fromAccountId: 'source',
  toAccountId: 'destination',
};
const row = (n) => ({
  id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
  cursorTs: `2026-10-25T00:00:00.${String(n).padStart(6, '0')}Z`,
  ruleCode: 'LARGE_TRANSACTION',
});

beforeEach(() => {
  jest.resetAllMocks();
  users.findById.mockResolvedValue({ role: 'admin' });
  transactions.countRecentOutgoingTransfers.mockResolvedValue(5);
  repository.findPage.mockResolvedValue([]);
});
test('records both rules using the SAME client and current transaction', async () => {
  await service.record(client, tx);
  expect(transactions.countRecentOutgoingTransfers).toHaveBeenCalledWith(client, 'source', 'tx');
  expect(repository.insert).toHaveBeenCalledTimes(2);
  for (const call of repository.insert.mock.calls) {
    expect(call[0]).toBe(client);
    expect(call[1]).toBe(tx);
  }
});
test('does not query transfer velocity for deposits or withdrawals', async () => {
  for (const type of ['deposit', 'withdrawal']) await service.record(client, { ...tx, type });
  expect(transactions.countRecentOutgoingTransfers).not.toHaveBeenCalled();
  expect(repository.insert).toHaveBeenCalledTimes(2);
});
test('non-completed ledger rows do not trigger queries or alerts', async () => {
  await service.record(client, { ...tx, status: 'failed' });
  expect(repository.insert).not.toHaveBeenCalled();
  expect(transactions.countRecentOutgoingTransfers).not.toHaveBeenCalled();
});
test('a small, slow transfer produces no alert', async () => {
  transactions.countRecentOutgoingTransfers.mockResolvedValue(4);
  await service.record(client, { ...tx, amount: 100 });
  expect(repository.insert).not.toHaveBeenCalled();
});
test('write failure propagates so the caller rolls back', async () => {
  repository.insert.mockRejectedValue(new Error('alert write failed'));
  await expect(service.record(client, tx)).rejects.toThrow('alert write failed');
});
test('velocity-query failure also propagates', async () => {
  transactions.countRecentOutgoingTransfers.mockRejectedValue(new Error('count failed'));
  await expect(service.record(client, tx)).rejects.toThrow('count failed');
  expect(repository.insert).not.toHaveBeenCalled();
});
test.each(['list', 'get'])('%s rechecks current admin before reading alerts', async (method) => {
  users.findById.mockResolvedValue({ role: 'user' });
  await expect(service[method]('admin', { limit: 20 })).rejects.toMatchObject({ statusCode: 403 });
  users.findById.mockResolvedValue(null);
  await expect(service[method]('admin', { limit: 20 })).rejects.toMatchObject({ statusCode: 401 });
  expect(repository.findPage).not.toHaveBeenCalled();
  expect(repository.findById).not.toHaveBeenCalled();
});
test('empty results return a complete empty pagination response', async () => {
  expect(await service.list('admin', { limit: 20 })).toEqual({
    alerts: [],
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  });
});
test('requests an extra row and builds the cursor from the last RETURNED row', async () => {
  repository.findPage.mockResolvedValue([row(3), row(2), row(1)]);
  const result = await service.list('admin', { limit: 2, severity: 'medium' });
  expect(repository.findPage).toHaveBeenCalledWith({ limit: 3, severity: 'medium' });
  expect(result.alerts.map((entry) => entry.id)).toEqual([row(3).id, row(2).id]);
  expect(result.alerts[0]).not.toHaveProperty('cursorTs');
  expect(decodeCursor(result.pagination.nextCursor)).toEqual({
    createdAt: row(2).cursorTs,
    id: row(2).id,
  });
});
test('exactly a full page does not invent a next page', async () => {
  repository.findPage.mockResolvedValue([row(1)]);
  expect((await service.list('admin', { limit: 1 })).pagination).toEqual({
    limit: 1,
    hasMore: false,
    nextCursor: null,
  });
});
test('missing alert returns 404', async () => {
  repository.findById.mockResolvedValue(null);
  await expect(service.get('admin', 'missing')).rejects.toMatchObject({
    code: 'ALERT_NOT_FOUND',
    statusCode: 404,
  });
});
