const pino = require('pino');

module.exports = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  // pino-http includes headers by default. Never put bearer/session credentials
  // in production/container logs, including response cookies set in the future.
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
