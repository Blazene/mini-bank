const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const blueprint = YAML.parse(fs.readFileSync(path.join(root, 'render.yaml'), 'utf8'));
const service = blueprint.services[0];
const vars = Object.fromEntries(service.envVars.map((entry) => [entry.key, entry]));

test('Blueprint provisions only one free Docker API, not an expiring database or paid disk', () => {
  expect(Object.keys(blueprint)).toEqual(['services']);
  expect(blueprint.services).toHaveLength(1);
  expect(service).toMatchObject({
    type: 'web',
    name: 'mini-bank-api',
    runtime: 'docker',
    plan: 'free',
    region: 'singapore',
    branch: 'main',
    numInstances: 1,
    dockerfilePath: './Dockerfile',
    dockerContext: '.',
  });
  for (const key of ['disk', 'scaling', 'preDeployCommand', 'initialDeployHook']) {
    expect(service[key]).toBeUndefined();
  }
});

test('Render runs the migration bootstrap, checks database health and gates automatic deploys on CI', () => {
  expect(service.dockerCommand).toBe('/bin/sh scripts/start-render.sh');
  expect(service.healthCheckPath).toBe('/api/v1/health');
  expect(service.autoDeployTrigger).toBe('checksPass');
  expect(service.autoDeploy).toBeUndefined();
  expect(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')).toContain(
    'COPY scripts/start-render.sh ./scripts/start-render.sh'
  );
  expect(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')).toContain(
    '!scripts/start-render.sh'
  );
});

test('database credentials are prompted privately and JWT secret is generated, never committed', () => {
  expect(vars.DATABASE_URL).toEqual({ key: 'DATABASE_URL', sync: false });
  expect(vars.JWT_SECRET).toEqual({ key: 'JWT_SECRET', generateValue: true });
  expect(new Set(service.envVars.map((entry) => entry.key)).size).toBe(service.envVars.length);
});

test('production settings enable limits, bounded DB connections and exactly one proxy hop', () => {
  const values = Object.fromEntries(
    service.envVars
      .filter((entry) => entry.value !== undefined)
      .map((entry) => [entry.key, entry.value])
  );
  expect(values).toEqual({
    NODE_ENV: 'production',
    PORT: '10000',
    JWT_EXPIRES_IN: '1h',
    BCRYPT_ROUNDS: '12',
    RATE_LIMIT_ENABLED: 'true',
    TRUST_PROXY: '1',
    DB_POOL_MAX: '5',
    DB_CONNECTION_TIMEOUT_MS: '10000',
  });
  expect(vars.CORS_ORIGINS).toBeUndefined(); // production defaults to no browser origin permission
});
