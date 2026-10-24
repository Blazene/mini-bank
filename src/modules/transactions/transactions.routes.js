const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const requireIdempotencyKey = require('../../shared/middleware/idempotencyKey');
const { transferLimiter, transferMissLimiter } = require('../../shared/middleware/rateLimit');
const { requireAuth } = require('../auth/auth.middleware');
const { audit } = require('../audit/audit.middleware');
const { moneyMovementSchema, transferSchema } = require('./transactions.schema');
const { listTransactionsQuerySchema } = require('./history.schema');
const controller = require('./transactions.controller');
const historyController = require('./history.controller');

// Every money route needs a logged-in user. Placed first so a route added later is protected.
router.use(requireAuth);

router.get('/', validate(listTransactionsQuerySchema, 'query'), historyController.list);

// audit() sits right after requireAuth (so it knows the user) and before everything else
// (so refusals by the limiters, the idempotency check and validation are logged too).
router.post(
  '/deposit',
  audit('transaction.deposit'),
  requireIdempotencyKey,
  validate(moneyMovementSchema),
  controller.deposit
);
router.post(
  '/withdraw',
  audit('transaction.withdraw'),
  requireIdempotencyKey,
  validate(moneyMovementSchema),
  controller.withdraw
);

// The limiters key on req.user.id, so they must come after requireAuth (above).
router.post(
  '/transfer',
  audit('transaction.transfer'),
  transferLimiter,
  transferMissLimiter,
  requireIdempotencyKey,
  validate(transferSchema),
  controller.transfer
);

module.exports = router;
