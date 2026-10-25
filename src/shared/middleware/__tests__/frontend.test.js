const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const mountFrontend = require('../frontend');
const notFound = require('../notFound');
const errorHandler = require('../errorHandler');
let directory;
let app;
const html = '<!doctype html><html><body><div id="root">test-client</div></body></html>';

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bank-static-'));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.mkdirSync(path.join(directory, 'api/v9'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(path.join(directory, 'assets/client-hash.js'), 'console.log("test client");');
  fs.writeFileSync(
    path.join(directory, 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>'
  );
  fs.writeFileSync(path.join(directory, '.env'), 'PRIVATE_TEST_MARKER');
  fs.writeFileSync(path.join(directory, 'api/v9/index.html'), 'not-an-api-response');
  app = express();
  app.use(helmet());
  app.get('/api/v1/probe', (_req, res) => res.json({ ok: true }));
  expect(mountFrontend(app, { directory })).toBe(true);
  app.use(notFound);
  app.use(errorHandler);
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

test('a checkout without a client build remains a working API-only application', async () => {
  const apiOnly = express();
  expect(mountFrontend(apiOnly, { directory: path.join(directory, 'missing') })).toBe(false);
  apiOnly.use(notFound);
  expect((await request(apiOnly).get('/')).status).toBe(404);
});
test.each(['/', '/login', '/login/', '/app', '/app/accounts', '/demo/overview', '/demo/loans'])(
  'serves non-cacheable HTML for navigation to %s',
  async (route) => {
    const response = await request(app).get(route).set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.text).toBe(html);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  }
);
test('HEAD navigation has HTML headers but no body', async () => {
  const response = await request(app).head('/app/accounts');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/html/);
  expect(response.text).toBeUndefined();
});
test('direct index requests cannot retain an old shell in cache', async () => {
  expect((await request(app).get('/index.html')).headers['cache-control']).toBe('no-store');
});
test('hashed assets are immutable and other public files revalidate', async () => {
  const asset = await request(app).get('/assets/client-hash.js');
  expect(asset.status).toBe(200);
  expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(asset.headers['content-type']).toMatch(/javascript/);
  const icon = await request(app).get('/favicon.svg');
  expect(icon.status).toBe(200);
  expect(icon.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
});
test('existing API operations remain JSON', async () => {
  expect((await request(app).get('/api/v1/probe')).body).toEqual({ ok: true });
});
test.each([
  '/api',
  '/api/v1/not-a-route',
  '/api/v9/index.html',
  '/assets/missing.js',
  '/app/missing.js',
  '/not-a-page',
  '/.env',
])('does not fall back to HTML for %s', async (route) => {
  const response = await request(app).get(route).set('Accept', 'text/html');
  expect(response.status).toBe(404);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body.error).toBeDefined();
  expect(response.text).not.toContain('PRIVATE_TEST_MARKER');
});
test('JSON requests and unsupported UI methods keep normal not-found semantics', async () => {
  expect((await request(app).get('/app/accounts').set('Accept', 'application/json')).status).toBe(
    404
  );
  expect((await request(app).post('/login')).status).toBe(404);
});
