const bcrypt = require('bcrypt');
const env = require('../../config/env');
const AppError = require('../../shared/utils/AppError');
const repository = require('./auth.repository');
const { signAccessToken } = require('./auth.tokens');

// A real hash of a throwaway password. When the email is unknown we still run a compare
// against it, so "no such user" takes about as long as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', env.BCRYPT_ROUNDS);

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

async function login({ email, password }) {
  const found = await repository.findByEmailWithHash(email);

  const passwordMatches = await bcrypt.compare(password, found ? found.passwordHash : DUMMY_HASH);

  // One message for both failures, so an attacker cannot tell which emails exist.
  if (!found || !passwordMatches) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // found.user never contains the hash, so it is safe to return.
  return { token: signAccessToken(found.user), user: found.user };
}

// The token proves who the caller WAS when it was issued. This reads who they are NOW.
async function getCurrentUser(userId) {
  const user = await repository.findById(userId);
  if (!user) {
    // A valid token for a user that no longer exists must not keep working.
    throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }
  return user;
}

module.exports = { register, login, getCurrentUser };
