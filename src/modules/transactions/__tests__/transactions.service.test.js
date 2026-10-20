const mockClient = { name: 'fake-client' };

jest.mock('../../../config/db', () => ({
  withTransaction: (fn) => fn(mockClient),
}));
jest.mock('../../accounts/accounts.repository');
jest.mock('../transactions.repository');

const accountsRepository = require('../../accounts/accounts.repository');
const transactionsRepository = require('../transactions.repository');
const service = require('../transactions.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const KEY = 'test-key-12345678';
const input = { accountId: ACCOUNT_ID, amount: 300, description: 'test', idempotencyKey: KEY };

const account = (overrides = {}) => ({
  id: ACCOUNT_ID,
  balance: 1000,
  status: 'active',
  ...overrides,
});

const previous = (overrides = {}) => ({
  id: 'tx-old',
  type: 'deposit',
  amount: 300,
  description: 'test',
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  accountsRepository.adjustBalance.mockResolvedValue({ id: ACCOUNT_ID, balance: 0 });
  transactionsRepository.insert.mockResolvedValue({ id: 'tx-1' });
  transactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
});

function expectNothingWritten() {
  expect(accountsRepository.adjustBalance).not.toHaveBeenCalled();
  expect(transactionsRepository.insert).not.toHaveBeenCalled();
}

describe('deposit', () => {
  test('locks the owned account, adds the amount and records a deposit with the key', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());

    const result = await service.deposit(USER_ID, input);

    expect(accountsRepository.lockByIdForUser).toHaveBeenCalledWith(
      mockClient,
      ACCOUNT_ID,
      USER_ID
    );
    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, ACCOUNT_ID, 300);
    expect(transactionsRepository.insert).toHaveBeenCalledWith(mockClient, {
      type: 'deposit',
      fromAccountId: null,
      toAccountId: ACCOUNT_ID,
      amount: 300,
      description: 'test',
      idempotencyKey: KEY,
    });
    expect(result.transaction).toEqual({ id: 'tx-1' });
    expect(result.replayed).toBe(false);
  });

  test('throws 404 when the account is missing or belongs to someone else', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(null);

    await expect(service.deposit(USER_ID, input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
    expectNothingWritten();
  });

  test.each(['frozen', 'closed'])('throws 409 for a %s account', async (status) => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ status }));

    await expect(service.deposit(USER_ID, input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCOUNT_NOT_ACTIVE',
    });
    expectNothingWritten();
  });

  test('throws 422 when the new balance would be too large to represent', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(
      account({ balance: Number.MAX_SAFE_INTEGER - 100 })
    );

    await expect(service.deposit(USER_ID, input)).rejects.toMatchObject({
      statusCode: 422,
      code: 'BALANCE_LIMIT_EXCEEDED',
    });
    expectNothingWritten();
  });
});

describe('withdraw', () => {
  test('subtracts the amount and records a withdrawal from the account', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());

    await service.withdraw(USER_ID, input);

    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, ACCOUNT_ID, -300);
    expect(transactionsRepository.insert).toHaveBeenCalledWith(mockClient, {
      type: 'withdrawal',
      fromAccountId: ACCOUNT_ID,
      toAccountId: null,
      amount: 300,
      description: 'test',
      idempotencyKey: KEY,
    });
  });

  test('allows withdrawing exactly the whole balance', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ balance: 300 }));

    await service.withdraw(USER_ID, input);

    expect(accountsRepository.adjustBalance).toHaveBeenCalledWith(mockClient, ACCOUNT_ID, -300);
  });

  test('throws 422 INSUFFICIENT_FUNDS when the balance is one paisa short', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ balance: 299 }));

    await expect(service.withdraw(USER_ID, input)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INSUFFICIENT_FUNDS',
    });
    expectNothingWritten();
  });

  test('throws 404 when the account is missing or belongs to someone else', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(null);

    await expect(service.withdraw(USER_ID, input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
    expectNothingWritten();
  });

  test('throws 409 for a frozen account', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ status: 'frozen' }));

    await expect(service.withdraw(USER_ID, input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACCOUNT_NOT_ACTIVE',
    });
    expectNothingWritten();
  });
});

describe('idempotency', () => {
  test('looks the key up on the locked account', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());

    await service.deposit(USER_ID, input);

    expect(transactionsRepository.findByIdempotencyKey).toHaveBeenCalledWith(
      mockClient,
      ACCOUNT_ID,
      KEY
    );
  });

  test('a repeated deposit returns the original transaction and writes nothing', async () => {
    const locked = account();
    accountsRepository.lockByIdForUser.mockResolvedValue(locked);
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous());

    const result = await service.deposit(USER_ID, input);

    expect(result).toEqual({ transaction: previous(), account: locked, replayed: true });
    expectNothingWritten();
  });

  test('a repeated withdrawal returns the original transaction and writes nothing', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(
      previous({ id: 'tx-w', type: 'withdrawal' })
    );

    const result = await service.withdraw(USER_ID, input);

    expect(result.replayed).toBe(true);
    expect(result.transaction.id).toBe('tx-w');
    expectNothingWritten();
  });

  test('a retry still succeeds after the account was frozen, because replay comes first', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ status: 'frozen' }));
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous());

    const result = await service.deposit(USER_ID, input);

    expect(result.replayed).toBe(true);
  });

  test('a retry still succeeds when the balance is no longer enough, because replay comes first', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account({ balance: 0 }));
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous({ type: 'withdrawal' }));

    const result = await service.withdraw(USER_ID, input);

    expect(result.replayed).toBe(true);
  });

  test.each([
    ['a different amount', { amount: 301 }],
    ['a different description', { description: 'something else' }],
    ['a different type', { type: 'withdrawal' }],
  ])('refuses the same key used with %s', async (label, difference) => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous(difference));

    await expect(service.deposit(USER_ID, input)).rejects.toMatchObject({
      statusCode: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expectNothingWritten();
  });

  test('treats a missing description and an empty one as the same request', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(account());
    transactionsRepository.findByIdempotencyKey.mockResolvedValue(previous({ description: null }));

    const result = await service.deposit(USER_ID, { ...input, description: '' });

    expect(result.replayed).toBe(true);
  });

  test('the key lookup does not run when the account is not the caller own', async () => {
    accountsRepository.lockByIdForUser.mockResolvedValue(null);

    await expect(service.deposit(USER_ID, input)).rejects.toMatchObject({ statusCode: 404 });
    expect(transactionsRepository.findByIdempotencyKey).not.toHaveBeenCalled();
  });
});
