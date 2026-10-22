const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const requireIdempotencyKey = require('../../shared/middleware/idempotencyKey');
const { requireAuth } = require('../auth/auth.middleware');
const { moneyMovementSchema, transferSchema } = require('./transactions.schema');
const { listTransactionsQuerySchema } = require('./history.schema');
const controller = require('./transactions.controller');
const historyController = require('./history.controller');

// Every money route needs a logged-in user. Placed first so a route added later is protected.
router.use(requireAuth);

router.get('/', validate(listTransactionsQuerySchema, 'query'), historyController.list);

router.post('/deposit', requireIdempotencyKey, validate(moneyMovementSchema), controller.deposit);
router.post('/withdraw', requireIdempotencyKey, validate(moneyMovementSchema), controller.withdraw);
router.post('/transfer', requireIdempotencyKey, validate(transferSchema), controller.transfer);

module.exports = router;
