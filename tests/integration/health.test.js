const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/db');

afterAll(async () => {
  await pool.end();
});

test('GET /api/v1/health returns ok', async () => {
  const res = await request(app).get('/api/v1/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
});

test('unknown route returns 404', async () => {
  const res = await request(app).get('/api/v1/nope');
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('NOT_FOUND');
});