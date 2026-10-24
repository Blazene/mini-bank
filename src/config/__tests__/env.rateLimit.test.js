// env.js reads process.env when it is first loaded, so each case loads a fresh copy of it.
// Values set here win over the ones in .env.test (dotenv never overwrites existing values).
function loadEnvWith(overrides) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  try {
    let loaded;
    jest.isolateModules(() => {
      loaded = require('../env');
    });
    return loaded;
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('RATE_LIMIT_ENABLED', () => {
  test('the text "true" turns limiting on', () => {
    expect(loadEnvWith({ RATE_LIMIT_ENABLED: 'true' }).RATE_LIMIT_ENABLED).toBe(true);
  });

  test('the text "false" turns limiting OFF (a plain boolean coercion would say true)', () => {
    expect(loadEnvWith({ RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED).toBe(false);
  });

  test.each(['banana', '0', '1', 'FALSE', ''])('refuses %p instead of guessing', (value) => {
    expect(() => loadEnvWith({ RATE_LIMIT_ENABLED: value })).toThrow();
  });
});

describe('TRUST_PROXY', () => {
  test('is a number of proxies', () => {
    expect(loadEnvWith({ TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(loadEnvWith({ TRUST_PROXY: '0' }).TRUST_PROXY).toBe(0);
  });

  test.each(['-1', '1.5', 'true', 'abc'])('refuses %p', (value) => {
    expect(() => loadEnvWith({ TRUST_PROXY: value })).toThrow();
  });
});
