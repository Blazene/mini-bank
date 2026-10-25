const mockLines = [];
jest.mock('pino', () => {
  const real = jest.requireActual('pino');
  return (options) => real(options, { write: (line) => mockLines.push(JSON.parse(line)) });
});

test('production logs redact credential headers while retaining useful diagnostics', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    jest.isolateModules(() => {
      const logger = require('../logger');
      logger.info(
        {
          req: {
            method: 'GET',
            headers: {
              authorization: 'Bearer private-token',
              cookie: 'session=private-session',
              'user-agent': 'verification-client',
            },
          },
          res: { statusCode: 200, headers: { 'set-cookie': ['session=private-response'] } },
        },
        'probe'
      );
    });
    expect(mockLines).toHaveLength(1);
    expect(mockLines[0].req.headers).toEqual({
      authorization: '[Redacted]',
      cookie: '[Redacted]',
      'user-agent': 'verification-client',
    });
    expect(mockLines[0].res.headers['set-cookie']).toBe('[Redacted]');
    expect(mockLines[0].res.statusCode).toBe(200);
    expect(JSON.stringify(mockLines)).not.toMatch(/private-token|private-session|private-response/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
