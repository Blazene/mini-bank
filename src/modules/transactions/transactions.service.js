const db = require('../../config/db');
const AppError = require('../../shared/utils/AppError');
const accountsRepository = require('../accounts/accounts.repository');
const transactionsRepository = require('./transactions.repository');
const monitoring = require('../monitoring/monitoring.service');

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
// result without touching any balance. The same key used for a DIFFERENT request (another type,
// another amount, another source or destination) is a client bug, and is refused rather than
// guessed at.
async function findReplay(client, account, expected) {
  const previous = await transactionsRepository.findByIdempotencyKey(
    client,
    account.id,
    expected.idempotencyKey
  );
  if (!previous) return null;

  const sameRequest =
    previous.type === expected.type &&
    previous.fromAccountId === expected.fromAccountId &&
    previous.toAccountId === expected.toAccountId &&
    previous.amount === expected.amount &&
    (previous.description || null) === (expected.description || null);
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
      fromAccountId: null,
      toAccountId: account.id,
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
    await monitoring.record(client, transaction);
    return { transaction, account: updated, replayed: false };
  });
}

function withdraw(userId, { accountId, amount, description, idempotencyKey }) {
  return db.withTransaction(async (client) => {
    const account = await lockOwnedAccount(client, userId, accountId);

    const replay = await findReplay(client, account, {
      type: 'withdrawal',
      fromAccountId: account.id,
      toAccountId: null,
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
    await monitoring.record(client, transaction);
    return { transaction, account: updated, replayed: false };
  });
}

// The recipient may be anyone's account, and a sender must not learn anything about it beyond
// "this works". A number that does not exist and an account that cannot receive money
// (frozen or closed) therefore get the same answer.
function destinationUnavailable() {
  return new AppError('Destination account not found or unavailable', 404, 'DESTINATION_NOT_FOUND');
}

// A transfer changes TWO balances, so it locks TWO rows. Locks are always taken lowest id first,
// whichever way the money flows. Without that, A to B and B to A at the same moment would each
// lock their own source and wait forever for the other: a deadlock.
function transfer(userId, { fromAccountId, toAccountNumber, amount, description, idempotencyKey }) {
  return db.withTransaction(async (client) => {
    // UUIDs are compared as text, so make them the same case first.
    const fromId = fromAccountId.toLowerCase();

    const toId = await accountsRepository.findIdByAccountNumber(client, toAccountNumber);
    if (!toId) throw destinationUnavailable();
    if (toId === fromId) {
      throw new AppError('Cannot transfer to the same account', 422, 'SAME_ACCOUNT_TRANSFER');
    }

    const locked = {};
    const lockOrder = fromId < toId ? [fromId, toId] : [toId, fromId];
    for (const id of lockOrder) {
      locked[id] =
        id === fromId
          ? await accountsRepository.lockByIdForUser(client, id, userId)
          : await accountsRepository.lockById(client, id);
    }

    const source = locked[fromId];
    const destination = locked[toId];
    if (!source) throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
    if (!destination) throw destinationUnavailable();

    const replay = await findReplay(client, source, {
      type: 'transfer',
      fromAccountId: fromId,
      toAccountId: toId,
      amount,
      description,
      idempotencyKey,
    });
    if (replay) return replay;

    assertActive(source);
    if (destination.status !== 'active') throw destinationUnavailable();
    if (source.balance < amount) {
      throw new AppError('Insufficient funds', 422, 'INSUFFICIENT_FUNDS');
    }
    if (destination.balance + amount > Number.MAX_SAFE_INTEGER) {
      throw new AppError(
        'Transfer would exceed the maximum balance of the destination account',
        422,
        'BALANCE_LIMIT_EXCEEDED'
      );
    }

    const updatedSource = await accountsRepository.adjustBalance(client, fromId, -amount);
    await accountsRepository.adjustBalance(client, toId, amount);
    const transaction = await transactionsRepository.insert(client, {
      type: 'transfer',
      fromAccountId: fromId,
      toAccountId: toId,
      amount,
      description,
      idempotencyKey,
    });
    await monitoring.record(client, transaction);
    return { transaction, account: updatedSource, replayed: false };
  });
}

module.exports = { deposit, withdraw, transfer };
