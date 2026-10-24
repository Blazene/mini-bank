const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const {
  registerLimiter,
  loginIpLimiter,
  loginEmailLimiter,
} = require('../../shared/middleware/rateLimit');
const { audit } = require('../audit/audit.middleware');
const { registerSchema, loginSchema } = require('./auth.schema');
const controller = require('./auth.controller');
const { requireAuth } = require('./auth.middleware');

// audit() comes first on these two routes, so that attempts the limiters or validation stop
// are written to the audit log as well.
router.post(
  '/register',
  audit('auth.register'),
  registerLimiter,
  validate(registerSchema),
  controller.register
);

// Order matters. The per-IP limiter goes first so a flood is stopped before any work is done.
// The per-email limiter goes after validate so it sees the cleaned email.
router.post(
  '/login',
  audit('auth.login'),
  loginIpLimiter,
  validate(loginSchema),
  loginEmailLimiter,
  controller.login
);
router.get('/me', requireAuth, controller.me);

module.exports = router;
