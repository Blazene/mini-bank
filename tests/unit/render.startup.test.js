const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bank-render-start-'));
  fs.mkdirSync(path.join(directory, 'src/config'), { recursive: true });
  // Run the real environment schema, but never load the developer's .env.
  fs.copyFileSync(path.join(root, 'src/config/env.js'), path.join(directory, 'src/config/env.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(directory, 'bin'));
  fs.writeFileSync(
    path.join(directory, 'src/server.js'),
    `
    require('node:fs').appendFileSync(process.env.EVENTS, 'server\\n');
    console.log('pid=' + process.pid);
  `
  );
  fs.writeFileSync(
    path.join(directory, 'bin/npm'),
    [
      '#!/bin/sh',
      'printf \'migrate:%s\\n\' "$*" >> "$EVENTS"',
      'exit "${MIGRATE_STATUS:-0}"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

function start(overrides = {}) {
  const eventsFile = path.join(directory, 'events');
  const child = spawnSync('/bin/sh', [path.join(root, 'scripts/start-render.sh')], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
    // Deliberately do not inherit database, SSL or Node preload settings from the host.
    env: {
      PATH: `${path.join(directory, 'bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgres://fake:private-db-password@ep-demo.ap-southeast-1.aws.neon.tech/demo?sslmode=verify-full',
      JWT_SECRET: 'test-only-startup-secret-with-at-least-32-characters',
      EVENTS: eventsFile,
      ...overrides,
    },
  });
  const events = fs.existsSync(eventsFile)
    ? fs.readFileSync(eventsFile, 'utf8').trim().split('\n')
    : [];
  expect(child.error).toBeUndefined();
  return { ...child, events };
}

test('valid configuration migrates first and execs Node as the original shell PID', () => {
  const result = start();
  expect(result.status).toBe(0);
  expect(result.events).toEqual(['migrate:run migrate -- up', 'server']);
  expect(result.stdout.trim()).toBe(`pid=${result.pid}`);
});

test('a migration failure propagates and never starts the API', () => {
  const result = start({ MIGRATE_STATUS: '17' });
  expect(result.status).toBe(17);
  expect(result.events).toEqual(['migrate:run migrate -- up']);
});

test.each([
  ['short JWT', { JWT_SECRET: 'short' }, /JWT_SECRET/],
  ['missing database', { DATABASE_URL: '' }, /DATABASE_URL/],
  ['invalid URL', { DATABASE_URL: 'postgres://private-db-password@[' }, /Invalid URL/],
  ['wrong protocol', { DATABASE_URL: 'https://example.com/db' }, /PostgreSQL protocol/],
  [
    'pooled Neon',
    {
      DATABASE_URL:
        'postgres://fake:private-db-password@ep-demo-pooler.ap-southeast-1.aws.neon.tech/demo?sslmode=verify-full',
    },
    /direct Neon connection/,
  ],
  ...['require', 'disable', 'no-verify', ''].map((mode) => [
    `TLS ${mode || 'missing'}`,
    {
      DATABASE_URL: `postgres://fake:private-db-password@ep-demo.ap-southeast-1.aws.neon.tech/demo${mode ? '?sslmode=' + mode : ''}`,
    },
    /sslmode=verify-full/,
  ]),
])(
  '%s fails before migrations without logging database credentials',
  (_label, overrides, message) => {
    const result = start(overrides);
    expect(result.status).not.toBe(0);
    expect(result.events).toEqual([]);
    expect(result.stderr).toMatch(message);
    expect(result.stderr + result.stdout).not.toContain('private-db-password');
  }
);

test('a local direct PostgreSQL URL supports isolated non-cloud container verification', () => {
  expect(start({ DATABASE_URL: 'postgres://fake:fake@db/demo' }).status).toBe(0);
});
