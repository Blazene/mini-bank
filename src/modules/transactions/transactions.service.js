const db = require('../../config/db');
const AppError = require('../../shared/utils/AppError');
const accountsRepository = require('../accounts/accounts.repository');
const transactionsRepository = require('./transactions.repository');

// Locks the caller's account for the rest of the transaction.
// Same 404 for "does not exist" and "belongs to someone else".
async function lockOwnedAccount(client, userId, accountId) {
  const account = await accountsRepository.lockByIdForUser(client, accountId, userId);
  if (!account) {
    throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
  }
  return account;
}

function assertActive(account) {
  if (account.status !== 'active') {
    throw new AppError(`Account is ${account.status}`, 409, 'ACCOUNT_NOT_ACTIVE');
  }
}

// Did this key already produce a transaction? Then it is a retry: hand back the original
// result without touching the balance. The same key used for a DIFFERENT request is a client
// bug, and is refused rather than guessed at.
async function findReplay(client, account, { type, amount, description, idempotencyKey }) {
  const previous = await transactionsRepository.findByIdempotencyKey(
    client,
    account.id,
    idempotencyKey
  );
  if (!previous) return null;

  const sameRequest =
    previous.type === type &&
    previous.amount === amount &&
    (previous.description || null) === (description || null);
  if (!sameRequest) {
    throw new AppError(
      'This Idempotency-Key was already used for a different request',
      422,
      'IDEMPOTENCY_KEY_REUSED'
    );
  }
  return { transaction: previous, account, replayed: true };
}

// Everything inside withTransaction is saved together or not at all.
// Order matters: lock and ownership, then the idempotency check, then the business rules.
// The replay check comes BEFORE the rules, so a retry of a request that already succeeded
// still answers "success" even if the account has been frozen since.
function deposit(userId, { accountId, amount, description, idempotencyKey }) {
  return db.withTransaction(async (client) => {
    const account = await lockOwnedAccount(client, userId, accountId);

    const replay = await findReplay(client, account, {
      type: 'deposit',
      amount,
      description,
      idempotencyKey,
    });
    if (replay) return replay;

    assertActive(account);
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
      idempotencyKey,
    });
    return { transaction, account: updated, replayed: false };
  });
}

function withdraw(userId, { accountId, amount, description, idempotencyKey }) {
  return db.withTransaction(async (client) => {
    const account = await lockOwnedAccount(client, userId, accountId);

    const replay = await findReplay(client, account, {
      type: 'withdrawal',
      amount,
      description,
      idempotencyKey,
    });
    if (replay) return replay;

    assertActive(account);
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
      idempotencyKey,
    });
    return { transaction, account: updated, replayed: false };
  });
}

module.exports = { deposit, withdraw };
