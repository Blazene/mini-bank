const db = require('../../config/db');
const AppError = require('../../shared/utils/AppError');
const accountsRepository = require('../accounts/accounts.repository');
const transactionsRepository = require('./transactions.repository');

// Locks the caller's account for the rest of the transaction and checks it can be used.
// Checks run in this order: exists and is yours (404), then is active (409).
async function lockUsableAccount(client, userId, accountId) {
  const account = await accountsRepository.lockByIdForUser(client, accountId, userId);
  if (!account) {
    // Same answer for "does not exist" and "belongs to someone else".
    throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
  }
  if (account.status !== 'active') {
    throw new AppError(`Account is ${account.status}`, 409, 'ACCOUNT_NOT_ACTIVE');
  }
  return account;
}

// Everything inside withTransaction is saved together or not at all: the balance change and
// the ledger row can never get out of step.
function deposit(userId, { accountId, amount, description }) {
  return db.withTransaction(async (client) => {
    const account = await lockUsableAccount(client, userId, accountId);

    if (account.balance + amount > Number.MAX_SAFE_INTEGER) {
      throw new AppError('Deposit would exceed the maximum balance', 422, 'BALANCE_LIMIT_EXCEEDED');
    }

    const updated = await accountsRepository.adjustBalance(client, accountId, amount);
    const transaction = await transactionsRepository.insert(client, {
      type: 'deposit',
      fromAccountId: null,
      toAccountId: accountId,
      amount,
      description,
    });
    return { transaction, account: updated };
  });
}

function withdraw(userId, { accountId, amount, description }) {
  return db.withTransaction(async (client) => {
    const account = await lockUsableAccount(client, userId, accountId);

    // The balance we check is the locked one, so nobody can spend it between this check
    // and the update below.
    if (account.balance < amount) {
      throw new AppError('Insufficient funds', 422, 'INSUFFICIENT_FUNDS');
    }

    const updated = await accountsRepository.adjustBalance(client, accountId, -amount);
    const transaction = await transactionsRepository.insert(client, {
      type: 'withdrawal',
      fromAccountId: accountId,
      toAccountId: null,
      amount,
      description,
    });
    return { transaction, account: updated };
  });
}

module.exports = { deposit, withdraw };
