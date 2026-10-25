const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');
const logger = require('./shared/utils/logger');
const { flushAuditWrites } = require('./modules/audit/audit.service');

const server = app.listen(env.PORT, () => {
  logger.info(`API running on port ${env.PORT}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    try {
      await flushAuditWrites();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Graceful shutdown failed');
      process.exit(1);
    }
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
