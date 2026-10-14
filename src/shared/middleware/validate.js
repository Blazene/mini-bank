const AppError = require('../utils/AppError');

// Usage: router.post('/register', validate(registerSchema), controller.register)
module.exports = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return next(new AppError('Invalid request data', 400, 'VALIDATION_ERROR', details));
  }

  req.body = result.data; // cleaned data: trimmed, lowercased, unknown fields removed
  return next();
};
