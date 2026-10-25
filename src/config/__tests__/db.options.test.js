const mockPool = { on: jest.fn(), query: jest.fn(), connect: jest.fn() };
jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }));
jest.mock('../env', () => ({
  DATABASE_URL: 'postgres://fake:fake@localhost/options_test',
  DB_POOL_MAX: 5,
  DB_CONNECTION_TIMEOUT_MS: 10000,
}));
jest.mock('../../shared/utils/logger', () => ({ error: jest.fn() }));
const { Pool } = require('pg');
const logger = require('../../shared/utils/logger');
require('../db');

test('pool respects configured limits/timeouts without disabling TLS verification', () => {
  expect(Pool).toHaveBeenCalledWith({
    connectionString: 'postgres://fake:fake@localhost/options_test',
    max: 5,
    connectionTimeoutMillis: 10000,
  });
});
test('idle connection errors are handled rather than becoming unhandled emitter errors', () => {
  expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
  const error = new Error('server closed idle connection');
  expect(() => mockPool.on.mock.calls[0][1](error)).not.toThrow();
  expect(logger.error).toHaveBeenCalledWith({ err: error }, 'Idle PostgreSQL client error');
});
