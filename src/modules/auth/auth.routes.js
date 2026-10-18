const router = require('express').Router();
const validate = require('../../shared/middleware/validate');
const { registerSchema } = require('./auth.schema');
const controller = require('./auth.controller');

router.post('/register', validate(registerSchema), controller.register);

module.exports = router;
