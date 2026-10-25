jest.mock('../app', () => ({ listen: jest.fn() }));
jest.mock('../config/env', () => ({ PORT: 4321 }));
jest.mock('../config/db', () => ({ pool: { end: jest.fn() } }));
jest.mock('../shared/utils/logger', () => ({ info: jest.fn() }));

let handlers;
let server;
let app;
let pool;
let logger;
let exit;

beforeEach(() => {
  handlers = {};
  server = { close: jest.fn() };
  // Capture handlers rather than attaching listeners or emitting real process signals.
  jest.spyOn(process, 'on').mockImplementation((signal, handler) => {
    handlers[signal] = handler;
    return process;
  });
  exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  jest.isolateModules(() => {
    app = require('../app');
    pool = require('../config/db').pool;
    logger = require('../shared/utils/logger');
    app.listen.mockImplementation((_port, callback) => {
      callback();
      return server;
    });
    pool.end.mockResolvedValue();
    require('../server');
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

test('starts on the configured port and logs readiness', () => {
  expect(app.listen).toHaveBeenCalledWith(4321, expect.any(Function));
  expect(logger.info).toHaveBeenCalledWith('API running on port 4321');
  expect(handlers).toEqual({ SIGINT: expect.any(Function), SIGTERM: expect.any(Function) });
});

test.each(['SIGINT', 'SIGTERM'])(
  '%s closes HTTP before ending the pool and exiting',
  async (signal) => {
    let finishPool;
    pool.end.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPool = resolve;
        })
    );
    handlers[signal]();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(pool.end).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const closing = server.close.mock.calls[0][0]();
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    finishPool();
    await closing;
    expect(exit).toHaveBeenCalledWith(0);
  }
);
