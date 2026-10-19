jest.mock('../accounts.repository');

const repository = require('../accounts.repository');
const service = require('../accounts.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function collisionError() {
  const err = new Error('duplicate key value violates unique constraint');
  err.code = '23505';
  err.constraint = 'accounts_account_number_key';
  return err;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('createAccount', () => {
  test('creates the account for the user with a 12-digit account number', async () => {
    repository.createAccount.mockResolvedValue({ id: ACCOUNT_ID });

    await service.createAccount(USER_ID, { type: 'savings' });

    const args = repository.createAccount.mock.calls[0][0];
    expect(args.userId).toBe(USER_ID);
    expect(args.type).toBe('savings');
    expect(args.accountNumber).toMatch(/^[1-9]\d{11}$/);
  });

  test('draws a new account number when one is already taken', async () => {
    repository.createAccount
      .mockRejectedValueOnce(collisionError())
      .mockResolvedValueOnce({ id: ACCOUNT_ID });

    const account = await service.createAccount(USER_ID, { type: 'current' });

    expect(account).toEqual({ id: ACCOUNT_ID });
    expect(repository.createAccount).toHaveBeenCalledTimes(2);
  });

  test('gives up after five collisions in a row', async () => {
    repository.createAccount.mockRejectedValue(collisionError());

    await expect(service.createAccount(USER_ID, { type: 'savings' })).rejects.toThrow(
      'Could not allocate a unique account number'
    );
    expect(repository.createAccount).toHaveBeenCalledTimes(5);
  });

  test('does not retry errors that are not account number collisions', async () => {
    const fkError = new Error('foreign key violation');
    fkError.code = '23503';
    repository.createAccount.mockRejectedValue(fkError);

    await expect(service.createAccount(USER_ID, { type: 'savings' })).rejects.toBe(fkError);
    expect(repository.createAccount).toHaveBeenCalledTimes(1);
  });
});

describe('getAccount', () => {
  test('looks the account up by id AND owner', async () => {
    repository.findByIdForUser.mockResolvedValue({ id: ACCOUNT_ID });

    await service.getAccount(USER_ID, ACCOUNT_ID);

    expect(repository.findByIdForUser).toHaveBeenCalledWith(ACCOUNT_ID, USER_ID);
  });

  test('throws 404 ACCOUNT_NOT_FOUND when there is no such account for this user', async () => {
    repository.findByIdForUser.mockResolvedValue(null);

    await expect(service.getAccount(USER_ID, ACCOUNT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ACCOUNT_NOT_FOUND',
    });
  });
});
