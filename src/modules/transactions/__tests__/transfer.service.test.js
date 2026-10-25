const mockClient = { name: 'fake-client' };

jest.mock('../../../config/db', () => ({
  withTransaction: (fn) => fn(mockClient),
}));
jest.mock('../../accounts/accounts.repository');
jest.mock('../transactions.repository');
jest.mock('../../monitoring/monitoring.service');

const accountsRepository = require('../../accounts/accounts.repository');
const transactionsRepository = require('../transactions.repository');
const service = require('../transactions.service');
const monitoring = require('../../monitoring/monitoring.service');

const USER_ID = '55555555-5555-4555-8555-555555555555';
const LOW_ID = '11111111-1111-4111-8111-111111111111';
const HIGH_ID = '99999999-9999-4999-8999-999999999999';
const NUMBER = '123456789012';
const KEY = 'transfer-key-1234';

const input = (fromAccountId, overrides = {}) => ({
  fromAccountId,
  toAccountNumber: NUMBER,
  amount: 300,
  description: 'rent',
  idempotencyKey: KEY,
  ...overrides,
});

const account = (id, overrides = {}) => ({ id, balance: 1000, status: 'active', ...overrides });

// A transfer from `fromId` to `toId`, with both accounts found and active unless overridden.
function arrange(fromId, toId, { source = {}, destination = {} } = {}) {
  accountsRepository.findIdByAccountNumber.mockResolvedValue(toId);
  accountsRepository.lockByIdForUser.mockResolvedValue(account(fromId, source));
  accountsRepository.lockById.mockResolvedValue(account(toId, destination));
}

const previous = (fromId, toId, overrides = {}) => ({
  id: 'tx-old',
  type: 'transfer',
  fromAccountId: fromId,
  toAccountId: toId,
  amount: 300,
  description: 'rent',
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  accountsRepository.adjustBalance.mockResolvedValue({ id: LOW_ID, balance: 700 });
  transactionsRepository.insert.mockResolvedValue({ id: 'tx-1' });
  transactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
});

function expectNothingWritten() {
  expect(accountsRepository.adjustBalance).not.toHaveBeenCalled();
  expect(transactionsRepository.insert).not.toHaveBeenCalled();
  expect(monitoring.record).not.toHaveBeenCalled();
}

describe('transfer', () => {
  test('refuses a destination that disappears between number lookup and row locking', async () => {
    arrange(LOW_ID, HIGH_ID);
    accountsRepository.lockById.mockResolvedValue(null);
    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 404,
      code: 'DESTINATION_NOT_FOUND',
    });
    expectNothingWritten();
    expect(transactionsRepository.findByIdempotencyKey).not.toHaveBeenCalled();
  });

  test('debits the source, credits the destination and records a transfer with the key', async () => {
    arrange(LOW_ID, HIGH_ID);

    const result = await service.transfer(USER_ID, input(LOW_ID));

    expect(accountsRepository.findIdByAccountNumber).toHaveBeenCalledWith(mockClient, NUMBER);
    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, LOW_ID, -300);
    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, HIGH_ID, 300);
    expect(transactionsRepository.insert).toHaveBeenCalledWith(mockClient, {
      type: 'transfer',
      fromAccountId: LOW_ID,
      toAccountId: HIGH_ID,
      amount: 300,
      description: 'rent',
      idempotencyKey: KEY,
    });
    expect(result).toEqual({
      transaction: { id: 'tx-1' },
      account: { id: LOW_ID, balance: 700 },
      replayed: false,
    });
    expect(monitoring.record).toHaveBeenCalledWith(mockClient, result.transaction);
    expect(monitoring.record.mock.invocationCallOrder[0]).toBeGreaterThan(
      transactionsRepository.insert.mock.invocationCallOrder[0]
    );
  });

  test.each([
    ['the source has the lower id', LOW_ID, HIGH_ID],
    ['the source has the higher id', HIGH_ID, LOW_ID],
  ])('always locks the lower id first, even when %s', async (label, fromId, toId) => {
    const order = [];
    accountsRepository.findIdByAccountNumber.mockResolvedValue(toId);
    accountsRepository.lockByIdForUser.mockImplementation(async (client, id) => {
      order.push(id);
      return account(id);
    });
    accountsRepository.lockById.mockImplementation(async (client, id) => {
      order.push(id);
      return account(id);
    });

    await service.transfer(USER_ID, input(fromId));

    expect(order).toEqual([LOW_ID, HIGH_ID]);
  });

  test('locks the source with the owner check and the destination without it', async () => {
    arrange(LOW_ID, HIGH_ID);

    await service.transfer(USER_ID, input(LOW_ID));

    expect(accountsRepository.lockByIdForUser).toHaveBeenCalledWith(mockClient, LOW_ID, USER_ID);
    expect(accountsRepository.lockById).toHaveBeenCalledWith(mockClient, HIGH_ID);
  });

  test('throws 404 DESTINATION_NOT_FOUND for an unknown account number, before locking anything', async () => {
    accountsRepository.findIdByAccountNumber.mockResolvedValue(null);

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 404,
      code: 'DESTINATION_NOT_FOUND',
    });
    expect(accountsRepository.lockByIdForUser).not.toHaveBeenCalled();
    expect(accountsRepository.lockById).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  test('throws 422 for a transfer to the same account, before locking anything', async () => {
    accountsRepository.findIdByAccountNumber.mockResolvedValue(LOW_ID);

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 422,
      code: 'SAME_ACCOUNT_TRANSFER',
    });
    expect(accountsRepository.lockByIdForUser).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  test('spots a transfer to the same account even if the id was sent in capitals', async () => {
    accountsRepository.findIdByAccountNumber.mockResolvedValue(HIGH_ID);

    await expect(service.transfer(USER_ID, input(HIGH_ID.toUpperCase()))).rejects.toMatchObject({
      code: 'SAME_ACCOUNT_TRANSFER',
    });
  });

  test('throws 404 ACCOUNT_NOT_FOUND when the source is not the caller own', async () => {
    arrange(LOW_ID, HIGH_ID);
    accountsRepository.lockByIdForUser.mockResolvedValue(null);

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
    expectNothingWritten();
  });

  test.each(['frozen', 'closed'])('throws 409 for a %s source account', async (status) => {
    arrange(LOW_ID, HIGH_ID, { source: { status } });

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCOUNT_NOT_ACTIVE',
    });
    expectNothingWritten();
  });

  test.each(['frozen', 'closed'])(
    'answers a %s destination exactly like a missing one',
    async (status) => {
      arrange(LOW_ID, HIGH_ID, { destination: { status } });

      await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
        statusCode: 404,
        code: 'DESTINATION_NOT_FOUND',
      });
      expectNothingWritten();
    }
  );

  test('throws 422 INSUFFICIENT_FUNDS when the source is one paisa short', async () => {
    arrange(LOW_ID, HIGH_ID, { source: { balance: 299 } });

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 422,
      code: 'INSUFFICIENT_FUNDS',
    });
    expectNothingWritten();
  });

  test('allows transferring exactly the whole balance', async () => {
    arrange(LOW_ID, HIGH_ID, { source: { balance: 300 } });

    await service.transfer(USER_ID, input(LOW_ID));

    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, LOW_ID, -300);
  });

  test('throws 422 when the destination could not hold the new balance', async () => {
    arrange(LOW_ID, HIGH_ID, { destination: { balance: Number.MAX_SAFE_INTEGER - 100 } });

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 422,
      code: 'BALANCE_LIMIT_EXCEEDED',
    });
    expectNothingWritten();
  });
});

describe('transfer idempotency', () => {
  test('looks the key up on the locked source account', async () => {
    arrange(LOW_ID, HIGH_ID);

    await service.transfer(USER_ID, input(LOW_ID));

    expect(transactionsRepository.findByIdempotencyKey).toHaveBeenCalledWith(
      mockClient,
      LOW_ID,
      KEY
    );
  });

  test('a repeated transfer returns the original and writes nothing', async () => {
    arrange(LOW_ID, HIGH_ID);
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous(LOW_ID, HIGH_ID));

    const result = await service.transfer(USER_ID, input(LOW_ID));

    expect(result.replayed).toBe(true);
    expect(result.transaction.id).toBe('tx-old');
    expectNothingWritten();
  });

  test('a retry still succeeds after the source was frozen, because replay comes first', async () => {
    arrange(LOW_ID, HIGH_ID, { source: { status: 'frozen' } });
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous(LOW_ID, HIGH_ID));

    const result = await service.transfer(USER_ID, input(LOW_ID));

    expect(result.replayed).toBe(true);
  });

  test('a retry still succeeds after the destination was frozen', async () => {
    arrange(LOW_ID, HIGH_ID, { destination: { status: 'frozen' } });
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous(LOW_ID, HIGH_ID));

    const result = await service.transfer(USER_ID, input(LOW_ID));

    expect(result.replayed).toBe(true);
  });

  test.each([
    ['a different amount', { amount: 301 }],
    ['a different description', { description: 'something else' }],
    ['a different destination', { toAccountId: '77777777-7777-4777-8777-777777777777' }],
    ['a different type', { type: 'withdrawal', toAccountId: null }],
  ])('refuses the same key used with %s', async (label, difference) => {
    arrange(LOW_ID, HIGH_ID);
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(
      previous(LOW_ID, HIGH_ID, difference)
    );

    await expect(service.transfer(USER_ID, input(LOW_ID))).rejects.toMatchObject({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expectNothingWritten();
  });

  test('treats a missing description and an empty one as the same request', async () => {
    arrange(LOW_ID, HIGH_ID);
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(
      previous(LOW_ID, HIGH_ID, { description: null })
    );

    const result = await service.transfer(USER_ID, input(LOW_ID, { description: '' }));

    expect(result.replayed).toBe(true);
  });
});
