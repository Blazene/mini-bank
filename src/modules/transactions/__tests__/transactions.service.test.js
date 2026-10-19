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
const input = { accountId: ACCOUNT_ID, amount: 300, description: 'test' };

const account = (overrides = {}) => ({
  id: ACCOUNT_ID,
  balance: 1000,
  status: 'active',
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  accountsRepository.adjustBalance.mockResolvedValue({ id: ACCOUNT_ID, balance: 0 });
  transactionsRepository.insert.mockResolvedValue({ id: 'tx-1' });
});

function expectNothingWritten() {
  expect(accountsRepository.adjustBalance).not.toHaveBeenCalled();
  expect(transactionsRepository.insert).not.toHaveBeenCalled();
}

describe('deposit', () => {
  test('locks the owned account, adds the amount and records a deposit', async () => {
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
    });
    expect(result.transaction).toEqual({ id: 'tx-1' });
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
