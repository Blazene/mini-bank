const router = require('express').Router();

router.use('/health', require('./health/health.routes'));
router.use('/auth', require('./auth/auth.routes'));
// The more specific path goes first, so /accounts/:id/transactions is never shadowed.
router.use('/accounts/:id/transactions', require('./transactions/accountHistory.routes'));
router.use('/accounts', require('./accounts/accounts.routes'));
router.use('/transactions', require('./transactions/transactions.routes'));
router.use('/loans', require('./loans/loans.routes'));
router.use('/admin/audit-logs', require('./audit/audit.routes'));
router.use('/admin/loan-applications', require('./loans/adminApplications.routes'));
router.use('/admin/alerts', require('./monitoring/monitoring.routes'));
router.use('/', require('./docs/docs.routes'));

module.exports = router;
