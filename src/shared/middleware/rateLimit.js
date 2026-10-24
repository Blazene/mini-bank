const { rateLimit, MemoryStore } = require('express-rate-limit');
const env = require('../../config/env');
const AppError = require('../utils/AppError');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Every limit in one place, so they are easy to read, tune and test.
//   windowMs = how long a counter lives, limit = how many requests it allows in that window
const LIMITS = {
  // Every route except /health, per IP address. A cheap flood guard.
  api: { windowMs: MINUTE, limit: 300 },
  // Account creation, per IP address. Slows down mass sign-ups and email probing.
  register: { windowMs: HOUR, limit: 10 },
  // FAILED logins per IP address, across any emails. Stops one machine guessing many accounts.
  loginIp: { windowMs: 15 * MINUTE, limit: 30 },
  // FAILED logins per email. Stops guessing one account, even from many IP addresses.
  loginEmail: { windowMs: 15 * MINUTE, limit: 5 },
  // Transfer attempts per logged-in user, successful or not.
  transfer: { windowMs: MINUTE, limit: 20 },
  // Transfers that ended in 404 (account or destination not found), per user. Stops probing
  // to find out which 12-digit account numbers exist.
  transferMiss: { windowMs: 15 * MINUTE, limit: 10 },
};

// One MemoryStore per limiter, kept here so tests can wipe every counter between tests.
// A memory store lives inside this one Node process. With several servers each would count
// separately, so production needs a shared store such as Redis (see docs).
const stores = [];

function createLimiter({ windowMs, limit }, options = {}) {
  const { skip, ...rest } = options;
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs,
    limit,
    store,
    // Sends RateLimit and RateLimit-Policy headers, and Retry-After once the limit is hit.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Read at request time, so a test can switch limiting on and off.
    skip: (req) => !env.RATE_LIMIT_ENABLED || (skip ? skip(req) : false),
    // Hand the error to the central errorHandler so it has the same shape as every other error.
    handler: (req, res, next) =>
      next(
        new AppError(
          'Too many requests. Please slow down and try again later.',
          429,
          'RATE_LIMITED'
        )
      ),
    ...rest,
  });
}

const apiLimiter = createLimiter(LIMITS.api, { skip: (req) => req.path === '/health' });

const registerLimiter = createLimiter(LIMITS.register);

// skipSuccessfulRequests: only requests that end in an error status are counted, so people
// who log in correctly are never slowed down.
const loginIpLimiter = createLimiter(LIMITS.loginIp, { skipSuccessfulRequests: true });

// Must run AFTER validate: req.body.email is then a trimmed, lower-case email, so A@x.com
// and a@x.com share one counter. The email is counted whether or not the account exists,
// so the limiter reveals nothing about which emails are registered.
const loginEmailLimiter = createLimiter(LIMITS.loginEmail, {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `email:${req.body.email}`,
});

// Must run AFTER requireAuth: the key is the verified user id from the token.
const transferLimiter = createLimiter(LIMITS.transfer, {
  keyGenerator: (req) => `user:${req.user.id}`,
});

const transferMissLimiter = createLimiter(LIMITS.transferMiss, {
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 404,
  keyGenerator: (req) => `user:${req.user.id}`,
});

function resetRateLimits() {
  stores.forEach((store) => store.resetAll());
}

module.exports = {
  LIMITS,
  apiLimiter,
  registerLimiter,
  loginIpLimiter,
  loginEmailLimiter,
  transferLimiter,
  transferMissLimiter,
  resetRateLimits,
};
