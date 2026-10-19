const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { requireAuth } = require('../auth/auth.middleware');
const { moneyMovementSchema } = require('./transactions.schema');
const controller = require('./transactions.controller');

// Every money route needs a logged-in user. Placed first so a route added later is protected.
router.use(requireAuth);

router.post('/deposit', validate(moneyMovementSchema), controller.deposit);
router.post('/withdraw', validate(moneyMovementSchema), controller.withdraw);

module.exports = router;
