const router = require('express').Router();
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { audit } = require('../audit/audit.middleware');
const validate = require('../../shared/middleware/validate');
const { applicationIdSchema, reviewSchema } = require('./loans.schema');
const controller = require('./reviews.controller');

router.use(requireAuth);
router.get('/:id', requireRole('admin'), validate(applicationIdSchema, 'params'), controller.get);
router.post(
  '/:id/review',
  audit('loan.review', { resourceParam: 'id' }),
  requireRole('admin'),
  validate(applicationIdSchema, 'params'),
  validate(reviewSchema),
  controller.review
);

module.exports = router;
