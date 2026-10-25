const express = require('express');
const request = require('supertest');
const cors = require('cors');
const options = require('../corsOptions');

function appFor(mode, origins = []) {
  const app = express();
  app.use(cors(options({ NODE_ENV: mode, CORS_ORIGINS: origins })));
  app.get('/probe', (_req, res) => res.json({ ok: true }));
  return app;
}
test('production defaults omit cross-origin permission while ordinary API requests work', async () => {
  const app = appFor('production');
  const res = await request(app).get('/probe').set('Origin', 'https://untrusted.example');
  expect(res.status).toBe(200);
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
});
test.each(['test', 'development'])(
  '%s preserves the existing permissive local behavior',
  async (mode) => {
    const res = await request(appFor(mode)).get('/probe').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  }
);
test('explicit allowlist permits the named frontend and exposes safe retry/rate headers', async () => {
  const app = appFor('production', ['https://frontend.example']);
  const allowed = await request(app).get('/probe').set('Origin', 'https://frontend.example');
  expect(allowed.headers['access-control-allow-origin']).toBe('https://frontend.example');
  expect(allowed.headers['access-control-expose-headers']).toContain('Idempotent-Replayed');
  expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
  const denied = await request(app).get('/probe').set('Origin', 'https://other.example');
  expect(denied.headers['access-control-allow-origin']).toBeUndefined();
});
test('allowed preflight supports bearer authorization and idempotency headers', async () => {
  const res = await request(appFor('production', ['https://frontend.example']))
    .options('/probe')
    .set('Origin', 'https://frontend.example')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,idempotency-key,content-type');
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-headers']).toContain('idempotency-key');
});
