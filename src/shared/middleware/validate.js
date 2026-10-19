const AppError = require('../utils/AppError');

// Usage: router.post('/register', validate(registerSchema), controller.register)
//        router.get('/:id', validate(idSchema, 'params'), controller.get)
// The second argument says which part of the request to check. It defaults to the body.
module.exports =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new AppError('Invalid request data', 400, 'VALIDATION_ERROR', details));
    }

    req[source] = result.data; // cleaned data: trimmed, lowercased, unknown fields removed
    return next();
  };
