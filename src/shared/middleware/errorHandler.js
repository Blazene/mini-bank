const logger = require('../utils/logger');

module.exports = (err, req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) logger.error({ err }, 'Unhandled error');

  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: status >= 500 ? 'Something went wrong' : err.message,
    },
  });
};
