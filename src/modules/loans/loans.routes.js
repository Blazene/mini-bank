const router = require('express').Router();
const { requireAuth } = require('../auth/auth.middleware');
const validate = require('../../shared/middleware/validate');
const { quoteSchema } = require('./loans.schema');
const controller = require('./loans.controller');

router.use(requireAuth);
router.post('/quote', validate(quoteSchema), controller.quote);

module.exports = router;
