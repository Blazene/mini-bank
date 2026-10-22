const router = require('express').Router({ mergeParams: true });
const validate = require('../../shared/middleware/validate');
const { requireAuth } = require('../auth/auth.middleware');
const { accountIdParamsSchema } = require('../accounts/accounts.schema');
const { accountTransactionsQuerySchema } = require('./history.schema');
const controller = require('./history.controller');

// Mounted at /accounts/:id/transactions (see modules/index.js). mergeParams lets this router
// see :id. It lives in the transactions module because the data is transactions.
router.use(requireAuth);

router.get(
  '/',
  validate(accountIdParamsSchema, 'params'),
  validate(accountTransactionsQuerySchema, 'query'),
  controller.listForAccount
);

module.exports = router;
