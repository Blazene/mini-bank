const router = require('express').Router();
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const validate = require('../../shared/middleware/validate');
const { querySchema, idSchema } = require('./monitoring.schema');
const controller = require('./monitoring.controller');

router.use(requireAuth, requireRole('admin'));
router.get('/', validate(querySchema, 'query'), controller.list);
router.get('/:id', validate(idSchema, 'params'), controller.get);

module.exports = router;
