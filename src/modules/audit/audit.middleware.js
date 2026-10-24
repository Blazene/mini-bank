const logger = require('../../shared/utils/logger');
const service = require('./audit.service');
const { REQUEST_ACTIONS, pickMetadata } = require('./audit.actions');

// Usage: router.post('/login', audit('auth.login'), ...)
//
// Records one audit row when the response has been sent, whatever the outcome: success,
// validation error, wrong password, rate limit. Put it BEFORE the limiters and validation on a
// route, so that requests those stop are logged too. Put it AFTER requireAuth where the
// caller must be logged in, so the row can name them.
function audit(action) {
  // Fail when the server starts, not on the first request, if a route names an unknown action.
  if (!REQUEST_ACTIONS[action]) throw new Error(`Unknown audit action: ${action}`);

  return (req, res, next) => {
    res.on('finish', () => {
      try {
        service.record({
          // res.locals.auditUserId is set by login and register, which learn who the user is
          // only after the work is done. Other routes know it from the token (req.user).
          userId: res.locals.auditUserId || (req.user && req.user.id) || null,
          action,
          outcome: res.statusCode < 400 ? 'success' : 'failure',
          statusCode: res.statusCode,
          ipAddress: req.ip || null,
          metadata: pickMetadata(action, req.body),
        });
      } catch (err) {
        // An event handler that throws would crash the process. Never let logging do that.
        logger.error({ err, action }, 'audit log could not be built');
      }
    });
    next();
  };
}

module.exports = { audit };
