const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { registerSchema, loginSchema } = require('./auth.schema');
const controller = require('./auth.controller');
const { requireAuth } = require('./auth.middleware');

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);
router.get('/me', requireAuth, controller.me);

module.exports = router;
