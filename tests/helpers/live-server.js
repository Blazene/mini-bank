// Child-process fixture for real TCP checks. Never import this as a Jest test.
const env = require('../../src/config/env');
if (env.NODE_ENV !== 'test' || !new URL(env.DATABASE_URL).pathname.endsWith('_test')) {
  throw new Error('Live verification requires NODE_ENV=test and a _test database');
}
const app = require('../../src/app');
const { pool } = require('../../src/config/db');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');

const server = app.listen(0, '127.0.0.1', () => {
  process.send({ port: server.address().port });
});
process.once('SIGTERM', () => {
  server.close(async () => {
    await flushAuditWrites();
    await pool.end();
    process.exit(0);
  });
});
