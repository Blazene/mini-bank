jest.mock('../audit.repository');
jest.mock('../../../shared/utils/logger', () => ({ error: jest.fn() }));

const repository = require('../audit.repository');
const logger = require('../../../shared/utils/logger');
const service = require('../audit.service');
const { decodeCursor } = require('../../transactions/history.cursor');

const entry = {
  userId: null,
  action: 'auth.login',
  outcome: 'failure',
  statusCode: 401,
  ipAddress: '1.2.3.4',
  metadata: { email: 'a@x.com' },
};

const row = (n) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
  userId: null,
  action: 'auth.login',
  outcome: 'failure',
  statusCode: 401,
  ipAddress: '1.2.3.4',
  metadata: {},
  createdAt: new Date('2026-10-22T10:00:00Z'),
  cursorTs: `2026-10-22T10:00:00.${String(n).padStart(6, '0')}Z`,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('record', () => {
  test('saves the entry', async () => {
    repository.insert.mockResolvedValue('new-id');
    service.record(entry);
    await service.flushAuditWrites();

    expect(repository.insert).toHaveBeenCalledWith(entry);
  });

  test('returns straight away, without waiting for the database', async () => {
    let finish;
    repository.insert.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    expect(service.record(entry)).toBeUndefined(); // the write has not finished yet

    finish('id'); // let it finish, so it does not stay pending for the next test
    await service.flushAuditWrites();
  });

  test('a failed write is reported to the server log and never thrown', async () => {
    const boom = new Error('database is down');
    repository.insert.mockRejectedValue(boom);

    expect(() => service.record(entry)).not.toThrow();
    await service.flushAuditWrites();

    expect(logger.error).toHaveBeenCalledWith(
      { err: boom, action: 'auth.login' },
      expect.stringMatching(/audit log write failed/)
    );
  });

  test('flushAuditWrites waits for writes that are still running', async () => {
    let finish;
    repository.insert.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    service.record(entry);

    let flushed = false;
    const waiting = service.flushAuditWrites().then(() => (flushed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushed).toBe(false);

    finish('id');
    await waiting;
    expect(flushed).toBe(true);
  });

  test('flushAuditWrites returns at once when nothing is pending', async () => {
    await expect(service.flushAuditWrites()).resolves.toBeUndefined();
  });
});

describe('listLogs', () => {
  const query = (overrides = {}) => ({ limit: 20, ...overrides });

  test('asks the repository for one row more than the limit', async () => {
    repository.findPage.mockResolvedValue([]);
    await service.listLogs(query({ limit: 5 }));
    expect(repository.findPage.mock.calls[0][0].limit).toBe(6);
  });

  test('passes the filters and cursor through', async () => {
    repository.findPage.mockResolvedValue([]);
    const from = new Date('2026-10-01T00:00:00Z');
    const cursor = { createdAt: '2026-10-22T10:00:00.000005Z', id: row(5).id };
    await service.listLogs(
      query({ action: 'auth.login', outcome: 'failure', userId: 'u1', from, cursor })
    );

    expect(repository.findPage.mock.calls[0][0]).toMatchObject({
      action: 'auth.login',
      outcome: 'failure',
      userId: 'u1',
      from,
      cursor,
    });
  });

  test('an empty log is an empty page', async () => {
    repository.findPage.mockResolvedValue([]);
    expect(await service.listLogs(query({ limit: 7 }))).toEqual({
      logs: [],
      pagination: { limit: 7, hasMore: false, nextCursor: null },
    });
  });

  test('exactly a full page means no next page', async () => {
    repository.findPage.mockResolvedValue([row(2), row(1)]);
    const result = await service.listLogs(query({ limit: 2 }));

    expect(result.logs).toHaveLength(2);
    expect(result.pagination).toEqual({ limit: 2, hasMore: false, nextCursor: null });
  });

  test('an extra row means a next page, the extra row is dropped, and the cursor is the LAST row returned', async () => {
    repository.findPage.mockResolvedValue([row(3), row(2), row(1)]);
    const result = await service.listLogs(query({ limit: 2 }));

    expect(result.logs.map((l) => l.id)).toEqual([row(3).id, row(2).id]);
    expect(result.pagination.hasMore).toBe(true);
    expect(decodeCursor(result.pagination.nextCursor)).toEqual({
      createdAt: row(2).cursorTs,
      id: row(2).id,
    });
  });

  test('the internal cursorTs field is not part of the response', async () => {
    repository.findPage.mockResolvedValue([row(1)]);
    const result = await service.listLogs(query());
    expect(result.logs[0]).not.toHaveProperty('cursorTs');
  });
});
