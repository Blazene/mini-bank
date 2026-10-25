const router = require('express').Router();
const { requireAuth } = require('../auth/auth.middleware');
const validate = require('../../shared/middleware/validate');
const { quoteSchema, applicationIdSchema } = require('./loans.schema');
const controller = require('./loans.controller');
const applications = require('./applications.controller');
const requireIdempotencyKey = require('../../shared/middleware/idempotencyKey');
const { audit } = require('../audit/audit.middleware');

router.use(requireAuth);
router.post('/quote', validate(quoteSchema), controller.quote);
router.post(
  '/applications',
  audit('loan.apply'),
  requireIdempotencyKey,
  validate(quoteSchema),
  applications.apply
);
router.get('/applications/:id', validate(applicationIdSchema, 'params'), applications.get);

module.exports = router;
