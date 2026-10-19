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

  // On server errors the client gets a generic code and message. Raw codes such as a
  // PostgreSQL error code would reveal internals, so they stay in the server log only.
  const code = known ? known.code : status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INTERNAL_ERROR';

  res.status(status).json({
    error: {
      code,
      message: known ? known.message : status >= 500 ? 'Something went wrong' : err.message,
      ...(status < 500 && err.details && { details: err.details }),
    },
  });
};
