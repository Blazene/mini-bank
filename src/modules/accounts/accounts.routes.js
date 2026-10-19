const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { requireAuth } = require('../auth/auth.middleware');
const { createAccountSchema, accountIdParamsSchema } = require('./accounts.schema');
const controller = require('./accounts.controller');

// Every accounts route needs a logged-in user. Putting requireAuth here, before any route,
// means a route added later is protected by default and cannot be forgotten.
router.use(requireAuth);

router.post('/', validate(createAccountSchema), controller.create);
router.get('/', controller.list);
router.get('/:id', validate(accountIdParamsSchema, 'params'), controller.get);

module.exports = router;
