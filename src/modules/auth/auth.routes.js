const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { registerSchema, loginSchema } = require('./auth.schema');
const controller = require('./auth.controller');

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);

module.exports = router;
