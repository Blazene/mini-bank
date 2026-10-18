const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../shared/utils/AppError');

// Pin the algorithm. Never let the token itself decide how it is verified.
const ALGORITHM = 'HS256';

function signAccessToken(user) {
  // The payload holds only what the server needs later: who (sub), and their role.
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: ALGORITHM,
  });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Token has expired', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }
}

module.exports = { signAccessToken, verifyAccessToken };
