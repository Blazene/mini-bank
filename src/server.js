const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');
const logger = require('./shared/utils/logger');

const server = app.listen(env.PORT, () => {
  logger.info(`API running on port ${env.PORT}`);
});

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);