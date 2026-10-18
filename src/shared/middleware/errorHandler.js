const logger = require('../utils/logger');

// Errors raised by Express's JSON body parser, translated into clean API errors
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
};

module.exports = (err, req, res, _next) => {
  const known = BODY_PARSER_ERRORS[err.type];
  const status = known ? known.status : err.statusCode || 500;
  if (status >= 500) logger.error({ err }, 'Unhandled error');

  res.status(status).json({
    error: {
      code: known ? known.code : err.code || 'INTERNAL_ERROR',
      message: known ? known.message : status >= 500 ? 'Something went wrong' : err.message,
      ...(err.details && { details: err.details }),
    },
  });
};
