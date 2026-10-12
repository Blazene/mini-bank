const router = require('express').Router();

router.use('/health', require('./health/health.routes'));
// Week 1: router.use('/auth', require('./auth/auth.routes'));

module.exports = router;
