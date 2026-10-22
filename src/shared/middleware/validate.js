const AppError = require('../utils/AppError');

// Usage: router.post('/register', validate(registerSchema), controller.register)
//        router.get('/:id', validate(idSchema, 'params'), controller.get)
//        router.get('/', validate(querySchema, 'query'), controller.list)
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

    // Cleaned data: trimmed, lowercased, defaults filled in, unknown fields removed.
    if (source === 'query') {
      // Express 5 defines req.query as a read-only getter, so req.query = data is silently
      // ignored and the controller would see the RAW strings. Defining our own property on
      // the request shadows the getter.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data;
    }
    return next();
  };
