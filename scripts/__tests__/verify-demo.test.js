const { parseArgs, verify, main } = require('../verify-demo');

test('defaults to a read-only local origin', () => {
  expect(parseArgs([])).toEqual({
    base: 'http://localhost:3000',
    write: false,
    allowRemoteWrites: false,
  });
});
test.each(['http://127.0.0.1:3456', 'http://[::1]:3456', 'https://demo.example'])(
  'accepts origin %s',
  (base) => {
    expect(parseArgs(['--base-url', base]).base).toBe(base);
  }
);
test.each([
  'not a URL',
  'postgres://user:private-password@example.com/db',
  'https://user:private-password@example.com',
  'https://demo.example/api/v1',
  'https://demo.example?secret=private-password',
  'https://demo.example#fragment',
  'http://demo.example',
  'http://localhost.evil.example',
])('refuses unsafe base %s without echoing secrets', (base) => {
  expect(() => parseArgs(['--base-url', base])).toThrow();
  try {
    parseArgs(['--base-url', base]);
  } catch (err) {
    expect(err.message).not.toContain('private-password');
  }
});
test.each([['--unknown'], ['--base-url'], ['extra']])('rejects invalid arguments %j', (...args) => {
  expect(() => parseArgs(args)).toThrow('Invalid arguments');
});
test('remote writes require a second explicit acknowledgement', () => {
  expect(() => parseArgs(['--base-url', 'https://demo.example', '--write'])).toThrow(
    'Remote writes require'
  );
  expect(
    parseArgs(['--base-url', 'https://demo.example', '--write', '--allow-remote-writes']).write
  ).toBe(true);
  expect(parseArgs(['--write']).write).toBe(true);
});
test('imported verifier also refuses unacknowledged remote writes before making requests', async () => {
  const fetchImpl = jest.fn();
  await expect(
    verify({ base: 'https://demo.example', write: true }, { fetchImpl })
  ).rejects.toThrow('Remote writes require');
  expect(fetchImpl).not.toHaveBeenCalled();
});

function transport({
  routeOverride,
  bodyOverride,
  headers: extraHeaders = {},
  status = 200,
  brokenJSON = false,
} = {}) {
  return jest.fn(async (url, options) => {
    const route = new URL(url).pathname;
    const headers = {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000',
      ...extraHeaders,
    };
    if (route === '/api/v1/health') {
      return new Response(
        brokenJSON ? 'not-json' : JSON.stringify(bodyOverride || { status: 'ok', database: 'up' }),
        { status, headers }
      );
    }
    if (route === '/api/v1/openapi.json')
      return Response.json(
        routeOverride || {
          openapi: '3.0.3',
          servers: [{ url: '/api/v1', description: 'Same-origin API' }],
        }
      );
    if (route === '/api/v1/docs/') return new Response('<div id="swagger-ui"></div>');
    if (route === '/api/v1/accounts')
      return Response.json({ error: { code: 'MISSING_TOKEN' } }, { status: 401 });
    if (route === '/api/v1/auth/me')
      return Response.json({ error: { code: 'INVALID_TOKEN' } }, { status: 401 });
    expect(options.method).toBe('POST');
    return Response.json(
      { token: 'do-not-log-response-token', password: 'do-not-log-response-password' },
      { status: 500 }
    );
  });
}

test('read-only verification issues only GETs and does not follow redirects', async () => {
  const fetchImpl = transport(),
    log = jest.fn();
  await verify({ base: 'https://demo.example' }, { fetchImpl, log });
  expect(fetchImpl).toHaveBeenCalledTimes(5);
  expect(
    fetchImpl.mock.calls.every(
      ([, options]) => options.method === 'GET' && options.redirect === 'error'
    )
  ).toBe(true);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('PASS:'));
});
test.each([
  [{ status: 503 }, 'Health/database'],
  [{ bodyOverride: { status: 'ok', database: 'down' } }, 'Health/database'],
  [{ headers: { 'Access-Control-Allow-Origin': '*' } }, 'CORS'],
  [{ headers: { 'X-Content-Type-Options': '' } }, 'nosniff'],
  [{ headers: { 'X-Powered-By': 'Express' } }, 'Framework'],
  [{ headers: { 'Strict-Transport-Security': '' } }, 'HSTS'],
  [{ routeOverride: { openapi: '3.0.3', servers: [{ url: 'https://wrong.example' }] } }, 'OpenAPI'],
  [{ routeOverride: { openapi: '3.0.3' } }, 'OpenAPI'],
  [{ brokenJSON: true }, 'Unreadable response'],
])('fails safely on invalid public response %j', async (options, message) => {
  await expect(
    verify({ base: 'https://demo.example' }, { fetchImpl: transport(options), log: jest.fn() })
  ).rejects.toThrow(message);
});
test('network failures never echo error messages that could contain credentials', async () => {
  const error = jest.fn();
  expect(
    await main([], {
      fetchImpl: async () => {
        throw new Error('private-password private-token');
      },
      error,
    })
  ).toBe(1);
  expect(error.mock.calls.flat().join(' ')).not.toMatch(/private-password|private-token/);
});
test('write failures never dump HTTP bodies or submitted passwords', async () => {
  const error = jest.fn(),
    log = jest.fn();
  expect(await main(['--write'], { fetchImpl: transport(), error, log })).toBe(1);
  expect(error.mock.calls.flat().join(' ')).toContain('Disposable registration failed');
  expect([...error.mock.calls, ...log.mock.calls].flat().join(' ')).not.toMatch(
    /do-not-log-response/
  );
});
test('help exits without network access', async () => {
  const log = jest.fn(),
    fetchImpl = jest.fn();
  expect(await main(['--help'], { log, fetchImpl })).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('Remote writes'));
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('main reports invalid options with nonzero status', async () => {
  const error = jest.fn();
  expect(await main(['--bad'], { error })).toBe(1);
  expect(error).toHaveBeenCalledWith('FAIL: Invalid arguments; use --help.');
});
