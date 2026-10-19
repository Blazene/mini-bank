const router = require('express').Router();

router.use('/health', require('./health/health.routes'));
router.use('/auth', require('./auth/auth.routes'));
router.use('/accounts', require('./accounts/accounts.routes'));

module.exports = router;
