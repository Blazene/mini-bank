// Do not read the user's .env or start a real logger when testing production selection.
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('pino', () => jest.fn((options) => ({ options })));

const dotenv = require('dotenv');
const pino = require('pino');
let saved;
const overrides = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://fake:fake@localhost/fake',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
};

beforeEach(() => {
  saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  jest.clearAllMocks();
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test.each([
  ['production', '.env'],
  ['development', '.env'],
  ['test', '.env.test'],
])('%s selects %s without opening it in this test', (mode, file) => {
  process.env.NODE_ENV = mode;
  jest.isolateModules(() => {
    expect(require('../env').NODE_ENV).toBe(mode);
  });
  expect(dotenv.config).toHaveBeenCalledWith({ path: file, quiet: true });
});

test.each([
  ['production', 'info'],
  ['development', 'info'],
  ['test', 'silent'],
])('%s logging uses %s', (mode, level) => {
  process.env.NODE_ENV = mode;
  jest.isolateModules(() => {
    require('../../shared/utils/logger');
  });
  expect(pino).toHaveBeenCalledWith({
    level,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  });
});
