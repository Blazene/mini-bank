const AppError = require('../../shared/utils/AppError');
const { verifyAccessToken } = require('./auth.tokens');

// Matches "Authorization: Bearer <token>". The scheme name is case-insensitive (RFC 7235).
const BEARER = /^Bearer\s+(.+)$/i;

// Authentication: who are you? Verifies the token and attaches the caller to req.user.
// It does not touch the database, so it stays fast. The token's signature is the proof.
function requireAuth(req, res, next) {
  const match = BEARER.exec(req.headers.authorization || '');
  if (!match) {
    return next(new AppError('Authentication required', 401, 'MISSING_TOKEN'));
  }

  // verifyAccessToken throws AppError 401 (INVALID_TOKEN or TOKEN_EXPIRED) on any problem.
  // Express catches errors thrown synchronously inside middleware and sends them to
  // the error handler, so no try/catch is needed here.
  const payload = verifyAccessToken(match[1].trim());
  req.user = { id: payload.sub, role: payload.role };
  return next();
}

// Authorization: are you allowed? Must run AFTER requireAuth.
// Usage: router.get('/x', requireAuth, requireRole('admin'), handler)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // No req.user means requireAuth was forgotten or ran later. Fail closed with 401.
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'MISSING_TOKEN'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to do this', 403, 'FORBIDDEN'));
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
