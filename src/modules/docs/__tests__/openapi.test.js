const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { spawnSync } = require('node:child_process');
const app = require('../../../app');
const spec = require('../openapi');

test('OpenAPI document passes structural and reference validation', () => {
  // Current parser dependencies use ESM. Native Node 22 handles this interop;
  // Jest's CommonJS runtime does not, so validate in a bounded child process.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const parser = require('@apidevtools/swagger-parser');
    const spec = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    parser.validate(spec).then(value => process.stdout.write(value.openapi))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  `,
    ],
    { input: JSON.stringify(spec), encoding: 'utf8', timeout: 10000 }
  );
  expect(result.error).toBeUndefined();
  expect({ status: result.status, error: result.stderr }).toEqual({ status: 0, error: '' });
  expect(result.stdout).toBe('3.0.3');
});

test('every mounted business route has a documented operation, and no nonexistent one is listed', () => {
  // Check literal router declarations rather than an independently maintained endpoint count.
  // Documentation utility endpoints are deliberately outside the business contract.
  const modules = path.resolve(__dirname, '../..');
  const index = fs.readFileSync(path.join(modules, 'index.js'), 'utf8');
  const actual = [];
  const mounts = [...index.matchAll(/router\.use\('([^']+)', require\('\.\/([^']+)'\)\)/g)];
  for (const [, prefix, file] of mounts) {
    if (file.startsWith('docs/')) continue;
    const source = fs.readFileSync(path.join(modules, `${file}.js`), 'utf8');
    for (const [, method, route] of source.matchAll(
      /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g
    )) {
      const full = `${prefix}${route === '/' ? '' : route}`.replace(/:([A-Za-z]+)/g, '{$1}');
      actual.push(`${method} ${full}`);
    }
  }
  const documented = Object.entries(spec.paths).flatMap(([route, methods]) =>
    Object.keys(methods).map((method) => `${method} ${route}`)
  );
  expect(actual.length).toBeGreaterThan(0);
  expect(documented.sort()).toEqual(actual.sort());
});

test('only health, registration and login are public in the business contract', () => {
  const publicOperations = [];
  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.security.length === 0) publicOperations.push(`${method} ${route}`);
      else expect(operation.security).toEqual([{ bearerAuth: [] }]);
    }
  }
  expect(publicOperations.sort()).toEqual([
    'get /health',
    'post /auth/login',
    'post /auth/register',
  ]);
});

test('all write retries requiring keys document the header; review documents natural idempotency', () => {
  for (const route of [
    '/transactions/deposit',
    '/transactions/withdraw',
    '/transactions/transfer',
    '/loans/applications',
  ]) {
    expect(spec.paths[route].post.parameters).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
      })
    );
  }
  expect(spec.paths['/admin/loan-applications/{id}/review'].post.parameters).not.toContainEqual(
    expect.objectContaining({ name: 'Idempotency-Key' })
  );
});

test('JSON reference is publicly readable and uses same-origin URLs', async () => {
  const res = await request(app).get('/api/v1/openapi.json');
  expect(res.status).toBe(200);
  expect(res.body).toEqual(spec);
  expect(res.body.servers).toEqual([{ url: '/api/v1', description: 'Same-origin API' }]);
});

test('Swagger UI and local scripts are served without relaxing Helmet script policy', async () => {
  const res = await request(app).get('/api/v1/docs/');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('text/html');
  expect(res.text).toContain('swagger-ui-bundle.js');
  expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  expect(res.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
  const script = await request(app).get('/api/v1/docs/swagger-ui-init.js');
  expect(script.status).toBe(200);
  expect(script.text).toContain('persistAuthorization');
  expect(script.text).toContain('Mini Digital Banking API');
  expect((await request(app).get('/api/v1/docs/swagger-ui-bundle.js')).status).toBe(200);
});
