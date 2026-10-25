jest.mock('dotenv', () => ({ config: jest.fn() }));

function load(overrides = {}) {
  const values = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://fake:fake@localhost/deployment_test',
    JWT_SECRET: 'not-a-production-secret-with-32-characters',
    PORT: undefined,
    CORS_ORIGINS: undefined,
    DB_POOL_MAX: undefined,
    DB_CONNECTION_TIMEOUT_MS: undefined,
    ...overrides,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let result;
    jest.isolateModules(() => {
      result = require('../env');
    });
    return result;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('deployment defaults keep bounded connections and no production origin allowlist', () => {
  expect(load()).toMatchObject({
    PORT: 3000,
    DB_POOL_MAX: 10,
    DB_CONNECTION_TIMEOUT_MS: 10000,
    CORS_ORIGINS: [],
  });
});
test('parses a comma-separated exact-origin allowlist', () => {
  expect(
    load({ CORS_ORIGINS: ' https://demo.example.com, http://localhost:5173 ' }).CORS_ORIGINS
  ).toEqual(['https://demo.example.com', 'http://localhost:5173']);
});
test.each([
  '*',
  'https://*.example.com',
  'https://demo.example.com/path',
  'https://demo.example.com/',
  'ftp://demo.example.com',
  'https://demo.example.com?x=1',
  'not-an-origin',
])('rejects invalid browser origin %p', (CORS_ORIGINS) => {
  expect(() => load({ CORS_ORIGINS })).toThrow();
});
test.each([
  ['PORT', '0'],
  ['PORT', '65536'],
  ['PORT', '1.5'],
  ['PORT', 'bad'],
  ['DB_POOL_MAX', '0'],
  ['DB_POOL_MAX', '21'],
  ['DB_POOL_MAX', '1.5'],
  ['DB_CONNECTION_TIMEOUT_MS', '999'],
  ['DB_CONNECTION_TIMEOUT_MS', '60001'],
  ['DB_CONNECTION_TIMEOUT_MS', 'bad'],
])('refuses invalid %s=%s', (key, value) => {
  expect(() => load({ [key]: value })).toThrow();
});
test.each([
  ['PORT', '1', 1],
  ['PORT', '65535', 65535],
  ['PORT', '10000', 10000],
  ['DB_POOL_MAX', '1', 1],
  ['DB_POOL_MAX', '20', 20],
  ['DB_CONNECTION_TIMEOUT_MS', '1000', 1000],
  ['DB_CONNECTION_TIMEOUT_MS', '60000', 60000],
])('accepts supported %s=%s', (key, value, expected) => {
  expect(load({ [key]: value })[key]).toBe(expected);
});
