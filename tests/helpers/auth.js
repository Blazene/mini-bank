const request = require('supertest');
const app = require('../../src/app');

// Registers a user through the real API and logs them in. Returns { token, user }.
async function registerAndLogin(email) {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ email, fullName: 'Test User', password: 'secret123' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'secret123' });
  return res.body;
}

module.exports = { registerAndLogin };
