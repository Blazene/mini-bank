const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = require('../../src/config/env');
const { pool, resetDb, createUser } = require('../helpers/db');

const root = path.resolve(__dirname, '../..');

function run(args = [], overrides = {}) {
  const name = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error('CLI tests require a _test database');
  const result = spawnSync(process.execPath, ['scripts/make-admin.js', ...args], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL, ...overrides },
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

beforeEach(async () => resetDb());
afterAll(async () => {
  await resetDb();
  await pool.end();
});

test('missing email exits nonzero with usage instructions and no writes', async () => {
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage: npm run make-admin -- someone@example.com');
  expect((await pool.query('SELECT * FROM audit_logs')).rows).toHaveLength(0);
});

test('unknown email exits nonzero without granting privileges or writing an audit success', async () => {
  const user = await createUser('existing@x.com');
  const result = run(['missing@x.com']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No user with the email missing@x.com');
  expect((await pool.query('SELECT role FROM users WHERE id=$1', [user.id])).rows[0].role).toBe(
    'user'
  );
  expect((await pool.query('SELECT * FROM audit_logs')).rows).toHaveLength(0);
});

test('real CLI grants admin, writes the audit entry, prints next steps and exits cleanly', async () => {
  const user = await createUser('operator-test@x.com');
  const result = run([user.email]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(`${user.email} is now an admin`);
  expect(result.stdout).toContain('log in again');
  expect((await pool.query('SELECT role FROM users WHERE id=$1', [user.id])).rows[0].role).toBe(
    'admin'
  );
  const logs = (await pool.query('SELECT * FROM audit_logs')).rows;
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    user_id: user.id,
    action: 'admin.role_granted',
    outcome: 'success',
    metadata: { email: user.email, via: 'make-admin script' },
  });
});

test('database connection failure exits nonzero instead of hanging or claiming success', () => {
  // Closed localhost port: deliberately do not connect to any real non-test database.
  const result = run(['operator-test@x.com'], {
    DATABASE_URL: 'postgres://fake:fake@127.0.0.1:1/cli_unavailable_test',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain('is now an admin');
});
