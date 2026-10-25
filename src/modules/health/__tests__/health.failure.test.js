jest.mock('../../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ error: jest.fn() }));
const express = require('express');
const request = require('supertest');
const db = require('../../../config/db');
const logger = require('../../../shared/utils/logger');
const router = require('../health.routes');
const errorHandler = require('../../../shared/middleware/errorHandler');

test('a failed health query reaches the error handler without exposing database details', async () => {
  const error = Object.assign(new Error('password rejected by internal-db.example'), {
    code: '28P01',
  });
  db.query.mockRejectedValueOnce(error);
  const app = express();
  app.use('/health', router);
  app.use(errorHandler);
  const res = await request(app).get('/health');
  expect(db.query).toHaveBeenCalledWith('SELECT 1');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  expect(logger.error).toHaveBeenCalledWith({ err: error }, 'Unhandled error');
});
