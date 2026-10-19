const crypto = require('node:crypto');
const AppError = require('../../shared/utils/AppError');
const repository = require('./accounts.repository');

const MAX_ATTEMPTS = 5;

// 12 digits, never starting with 0. crypto.randomInt is a cryptographically secure generator,
// so account numbers are not sequential or predictable.
function generateAccountNumber() {
  return String(crypto.randomInt(100000000000, 1000000000000));
}

async function createAccount(userId, { type }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await repository.createAccount({
        userId,
        accountNumber: generateAccountNumber(),
        type,
      });
    } catch (err) {
      // The unique constraint is the real guard against duplicate numbers. On a collision
      // (extremely rare) we just draw a new number and try again.
      const isNumberCollision =
        err.code === '23505' && err.constraint === 'accounts_account_number_key';
      if (!isNumberCollision) throw err;
    }
  }
  // Five collisions in a row in a space of 900 billion numbers means something is badly wrong.
  throw new Error('Could not allocate a unique account number');
}

function listAccounts(userId) {
  return repository.findAllByUser(userId);
}

async function getAccount(userId, accountId) {
  const account = await repository.findByIdForUser(accountId, userId);
  if (!account) {
    // Same answer whether the account does not exist or belongs to someone else, so a caller
    // cannot use this endpoint to discover which account ids exist.
    throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
  }
  return account;
}

module.exports = { createAccount, listAccounts, getAccount };
