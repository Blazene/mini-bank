jest.mock('../../accounts/accounts.repository');
jest.mock('../history.repository');

const accountsRepository = require('../../accounts/accounts.repository');
const historyRepository = require('../history.repository');
const service = require('../history.service');
const { decodeCursor } = require('../history.cursor');

const USER = '55555555-5555-4555-8555-555555555555';
const MINE = '11111111-1111-4111-8111-111111111111';
const MINE_TOO = '22222222-2222-4222-8222-222222222222';
const THEIRS = '99999999-9999-4999-8999-999999999999';
const THEIR_NUMBER = '123456789012';

const row = (n, overrides = {}) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
  type: 'deposit',
  fromAccountId: null,
  toAccountId: MINE,
  amount: 100 * n,
  status: 'completed',
  description: null,
  createdAt: new Date('2026-10-22T10:00:00Z'),
  cursorTs: `2026-10-22T10:00:00.${String(n).padStart(6, '0')}Z`,
  ...overrides,
});

const query = (overrides = {}) => ({ limit: 20, ...overrides });

beforeEach(() => {
  jest.resetAllMocks();
  accountsRepository.findAllByUser.mockResolvedValue([{ id: MINE }, { id: MINE_TOO }]);
  accountsRepository.findAccountNumbersByIds.mockResolvedValue(new Map());
  historyRepository.findPage.mockResolvedValue([]);
});

describe('scoping', () => {
  test("queries only the caller's own account ids, taken from the database by owner", async () => {
    await service.listHistory(USER, query());

    expect(accountsRepository.findAllByUser).toHaveBeenCalledWith(USER);
    expect(historyRepository.findPage.mock.calls[0][0].sort()).toEqual([MINE, MINE_TOO]);
  });

  test('a user with no accounts gets an empty page and the ledger is never queried', async () => {
    accountsRepository.findAllByUser.mockResolvedValue([]);
    const result = await service.listHistory(USER, query({ limit: 7 }));

    expect(result).toEqual({
      transactions: [],
      pagination: { limit: 7, hasMore: false, nextCursor: null },
    });
    expect(historyRepository.findPage).not.toHaveBeenCalled();
  });

  test('filtering by an account that is not yours is a 404 and the ledger is never queried', async () => {
    await expect(service.listHistory(USER, query({ accountId: THEIRS }))).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
    expect(historyRepository.findPage).not.toHaveBeenCalled();
  });

  test('filtering by one of your accounts narrows the query to just that account', async () => {
    await service.listHistory(USER, query({ accountId: MINE }));
    expect(historyRepository.findPage.mock.calls[0][0]).toEqual([MINE]);
  });

  test('an account id in capital letters still matches your account', async () => {
    await service.listHistory(USER, query({ accountId: MINE.toUpperCase() }));
    expect(historyRepository.findPage.mock.calls[0][0]).toEqual([MINE]);
  });

  test('passes the filters and the cursor through unchanged', async () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-31T00:00:00Z');
    const cursor = { createdAt: '2026-10-22T10:00:00.000005Z', id: row(5).id };
    await service.listHistory(USER, query({ type: 'transfer', from, to, cursor }));

    expect(historyRepository.findPage.mock.calls[0][1]).toMatchObject({
      type: 'transfer',
      from,
      to,
      cursor,
    });
  });
});

describe('paging', () => {
  test('asks the repository for one row more than the limit', async () => {
    await service.listHistory(USER, query({ limit: 5 }));
    expect(historyRepository.findPage.mock.calls[0][1].limit).toBe(6);
  });

  test('exactly a full page and nothing after it means no next page', async () => {
    historyRepository.findPage.mockResolvedValue([row(3), row(2), row(1)]);
    const result = await service.listHistory(USER, query({ limit: 3 }));

    expect(result.transactions).toHaveLength(3);
    expect(result.pagination).toEqual({ limit: 3, hasMore: false, nextCursor: null });
  });

  test('an extra row means a next page, and the extra row is not returned', async () => {
    historyRepository.findPage.mockResolvedValue([row(4), row(3), row(2), row(1)]);
    const result = await service.listHistory(USER, query({ limit: 3 }));

    expect(result.transactions.map((t) => t.amount)).toEqual([400, 300, 200]);
    expect(result.pagination.hasMore).toBe(true);
  });

  test('the next cursor points at the LAST row returned, not at the dropped extra row', async () => {
    historyRepository.findPage.mockResolvedValue([row(4), row(3), row(2), row(1)]);
    const result = await service.listHistory(USER, query({ limit: 3 }));

    expect(decodeCursor(result.pagination.nextCursor)).toEqual({
      createdAt: row(2).cursorTs,
      id: row(2).id,
    });
  });

  test('the internal cursorTs field is never part of the response', async () => {
    historyRepository.findPage.mockResolvedValue([row(1)]);
    const result = await service.listHistory(USER, query());
    expect(result.transactions[0]).not.toHaveProperty('cursorTs');
  });
});

describe('what the caller sees of each row', () => {
  test('a deposit into your account is a credit with no other party', async () => {
    historyRepository.findPage.mockResolvedValue([row(1)]);
    const [item] = (await service.listHistory(USER, query())).transactions;

    expect(item).toMatchObject({
      direction: 'credit',
      fromAccountId: null,
      toAccountId: MINE,
      counterpartyAccountNumber: null,
    });
  });

  test('a withdrawal from your account is a debit with no other party', async () => {
    historyRepository.findPage.mockResolvedValue([
      row(1, { type: 'withdrawal', fromAccountId: MINE, toAccountId: null }),
    ]);
    const [item] = (await service.listHistory(USER, query())).transactions;

    expect(item).toMatchObject({ direction: 'debit', fromAccountId: MINE, toAccountId: null });
    expect(item.counterpartyAccountNumber).toBeNull();
  });

  test('a transfer you sent is a debit, naming the receiver only by a masked number', async () => {
    accountsRepository.findAccountNumbersByIds.mockResolvedValue(new Map([[THEIRS, THEIR_NUMBER]]));
    historyRepository.findPage.mockResolvedValue([
      row(1, { type: 'transfer', fromAccountId: MINE, toAccountId: THEIRS }),
    ]);
    const [item] = (await service.listHistory(USER, query())).transactions;

    expect(item).toMatchObject({
      direction: 'debit',
      fromAccountId: MINE,
      toAccountId: null,
      counterpartyAccountNumber: 'XXXXXXXX9012',
    });
    expect(JSON.stringify(item)).not.toContain(THEIRS);
    expect(JSON.stringify(item)).not.toContain(THEIR_NUMBER);
  });

  test('a transfer you received is a credit, and the sender account id is hidden', async () => {
    accountsRepository.findAccountNumbersByIds.mockResolvedValue(new Map([[THEIRS, THEIR_NUMBER]]));
    historyRepository.findPage.mockResolvedValue([
      row(1, { type: 'transfer', fromAccountId: THEIRS, toAccountId: MINE }),
    ]);
    const [item] = (await service.listHistory(USER, query())).transactions;

    expect(item).toMatchObject({
      direction: 'credit',
      fromAccountId: null,
      toAccountId: MINE,
      counterpartyAccountNumber: 'XXXXXXXX9012',
    });
    expect(JSON.stringify(item)).not.toContain(THEIRS);
  });

  test('a transfer between two of your own accounts is internal', async () => {
    historyRepository.findPage.mockResolvedValue([
      row(1, { type: 'transfer', fromAccountId: MINE, toAccountId: MINE_TOO }),
    ]);
    const [item] = (await service.listHistory(USER, query())).transactions;

    expect(item).toMatchObject({
      direction: 'internal',
      fromAccountId: MINE,
      toAccountId: MINE_TOO,
      counterpartyAccountNumber: null,
    });
  });

  test('seen from ONE account, an own-account transfer is a debit or a credit again', async () => {
    accountsRepository.findAccountNumbersByIds.mockResolvedValue(
      new Map([[MINE_TOO, '555566667777']])
    );
    historyRepository.findPage.mockResolvedValue([
      row(1, { type: 'transfer', fromAccountId: MINE, toAccountId: MINE_TOO }),
    ]);

    const asSender = await service.listHistory(USER, query({ accountId: MINE }));
    expect(asSender.transactions[0].direction).toBe('debit');
    expect(asSender.transactions[0].counterpartyAccountNumber).toBe('XXXXXXXX7777');

    accountsRepository.findAccountNumbersByIds.mockResolvedValue(new Map([[MINE, '111122223333']]));
    const asReceiver = await service.listHistory(USER, query({ accountId: MINE_TOO }));
    expect(asReceiver.transactions[0].direction).toBe('credit');
  });

  test('looks up ALL the other parties in ONE batched query, each id once', async () => {
    const OTHER = '88888888-8888-4888-8888-888888888888';
    accountsRepository.findAccountNumbersByIds.mockResolvedValue(
      new Map([
        [THEIRS, THEIR_NUMBER],
        [OTHER, '555566667777'],
      ])
    );
    historyRepository.findPage.mockResolvedValue([
      row(4, { type: 'transfer', fromAccountId: MINE, toAccountId: THEIRS }),
      row(3, { type: 'transfer', fromAccountId: OTHER, toAccountId: MINE }),
      row(2, { type: 'transfer', fromAccountId: THEIRS, toAccountId: MINE }),
      row(1),
    ]);
    const result = await service.listHistory(USER, query());

    expect(accountsRepository.findAccountNumbersByIds).toHaveBeenCalledTimes(1);
    expect(accountsRepository.findAccountNumbersByIds.mock.calls[0][0].sort()).toEqual(
      [OTHER, THEIRS].sort()
    );
    expect(result.transactions.map((t) => t.counterpartyAccountNumber)).toEqual([
      'XXXXXXXX9012',
      'XXXXXXXX7777',
      'XXXXXXXX9012',
      null,
    ]);
  });
});
