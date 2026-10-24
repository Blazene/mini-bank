const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { auditLogsQuerySchema } = require('./audit.schema');
const controller = require('./audit.controller');

// Admins only. requireAuth first (who are you), then requireRole (are you allowed).
// Both sit above every route, so a route added later is protected by default.
router.use(requireAuth, requireRole('admin'));

router.get('/', validate(auditLogsQuerySchema, 'query'), controller.list);

module.exports = router;
