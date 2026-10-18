const bcrypt = require('bcrypt');
const env = require('../../config/env');
const AppError = require('../../shared/utils/AppError');
const repository = require('./auth.repository');

async function register({ email, fullName, password }) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  try {
    return await repository.createUser({ email, fullName, passwordHash });
  } catch (err) {
    // The unique index is the real guard. It also protects against two simultaneous sign-ups.
    if (err.code === '23505' && err.constraint === 'users_email_unique') {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
    }
    throw err;
  }
}

module.exports = { register };
