const AppError = require('../utils/AppError');

// 8 to 100 characters: letters, digits, hyphen, underscore, dot, colon. A UUID is ideal.
// Anything else (spaces, commas from a repeated header, empty values) is rejected.
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;

// Money-moving requests must carry an "Idempotency-Key" header. The client invents the key
// and sends the SAME key when it retries, so a retry can never move money twice.
function requireIdempotencyKey(req, res, next) {
  const key = req.headers['idempotency-key'];

  if (key === undefined) {
    return next(
      new AppError('Idempotency-Key header is required', 400, 'IDEMPOTENCY_KEY_REQUIRED')
    );
  }
  if (!KEY_PATTERN.test(key)) {
    return next(
      new AppError(
        'Idempotency-Key must be 8 to 100 characters: letters, digits, hyphen, underscore, dot or colon',
        400,
        'INVALID_IDEMPOTENCY_KEY'
      )
    );
  }

  req.idempotencyKey = key;
  return next();
}

module.exports = requireIdempotencyKey;
