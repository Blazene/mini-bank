// Explicit, opt-in Docker verification. It owns a unique project/image/volume and
// never runs `down` against the user's normal Compose project or database.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const suffix = randomBytes(5).toString('hex');
const project = `minibank_day21_${suffix}`;
const image = `mini-bank-day21:${suffix}`;
const secrets = [randomBytes(32).toString('hex')];
const env = {
  ...process.env,
  COMPOSE_PROFILES: '',
  APP_IMAGE: image,
  JWT_SECRET: secrets[0],
  JWT_EXPIRES_IN: '1h',
  BCRYPT_ROUNDS: '4',
  RATE_LIMIT_ENABLED: 'true',
  TRUST_PROXY: '0',
  CORS_ORIGINS: '',
  DB_POOL_MAX: '5',
  DB_CONNECTION_TIMEOUT_MS: '10000',
};
const prefix = ['compose', '--env-file', '/dev/null', '-p', project];
let base;
let safeProject = false;
let built = false;
let cloudContainer;

const scrub = (text) =>
  secrets.reduce((value, secret) => value.split(secret).join('[Redacted]'), text);
async function run(args, { allowFailure = false, timeout = 180000 } = {}) {
  try {
    const result = await exec('docker', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (allowFailure && Number.isInteger(error.code))
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    throw new Error(
      scrub(
        `docker ${args.join(' ')} failed: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`
      )
    );
  }
}
const compose = (args, options) => run([...prefix, '--profile', 'app', ...args], options);
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}
async function call(method, route, { token, body, key, cookie } = {}) {
  const res = await fetch(`${base}/api/v1${route}`, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function person(email) {
  const body = { email, fullName: 'Docker Verification', password: 'docker1234' };
  assert.equal((await call('POST', '/auth/register', { body })).status, 201);
  const login = await call('POST', '/auth/login', { body: { email, password: body.password } });
  assert.equal(login.status, 200);
  secrets.push(login.body.token);
  return { ...login.body, email, password: body.password };
}

async function verifyRenderStartup() {
  console.log('Checking the Render bootstrap with a fresh isolated database and port 10000.');
  await compose(['up', '--no-build', '-d', '--wait', 'db']);
  await compose(['exec', '-T', 'db', 'createdb', '-U', 'bank', 'minibank_render']);
  const port = await freePort();
  for (let attempt = 0; attempt < 2; attempt++) {
    cloudContainer = `${project}_render`;
    await compose([
      'run',
      '--no-deps',
      '-d',
      '--name',
      cloudContainer,
      '-e',
      'DATABASE_URL=postgres://bank:bankpass@db:5432/minibank_render',
      '-e',
      'PORT=10000',
      '-p',
      `127.0.0.1:${port}:10000`,
      'api',
      '/bin/sh',
      'scripts/start-render.sh',
    ]);
    let ready = false;
    for (let n = 0; n < 120; n++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
          headers: { Origin: 'https://untrusted.example' },
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          assert.deepEqual(await response.json(), { status: 'ok', database: 'up' });
          assert.equal(response.headers.get('access-control-allow-origin'), null);
          ready = true;
          break;
        }
      } catch {
        /* bounded wait while migrations run and HTTP becomes available */
      }
      await pause(500);
    }
    assert.ok(ready, 'Render bootstrap did not become healthy');
    const count = await compose([
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'bank',
      '-d',
      'minibank_render',
      '-At',
      '-c',
      'SELECT count(*) FROM pgmigrations',
    ]);
    assert.equal(count.stdout.trim(), '5');
    const logs = (await run(['logs', cloudContainer])).stdout;
    if (attempt === 1) assert.match(logs, /No migrations to run/);
    assert.ok(!logs.includes(env.JWT_SECRET), 'Bootstrap logged the JWT secret');
    await run(['stop', '--time', '20', cloudContainer]);
    const stopped = JSON.parse((await run(['inspect', cloudContainer])).stdout)[0];
    assert.equal(stopped.State.ExitCode, 0, 'Render process must handle SIGTERM cleanly');
    await run(['rm', cloudContainer]);
    cloudContainer = undefined;
  }
}

async function verify() {
  env.DB_PORT = await freePort();
  do {
    env.API_PORT = await freePort();
  } while (env.API_PORT === env.DB_PORT);
  base = `http://127.0.0.1:${env.API_PORT}`;
  console.log('Checking opt-in Compose configuration; normal database remains untouched.');
  const defaults = await run([...prefix, 'config', '--services']);
  assert.deepEqual(defaults.stdout.trim().split('\n'), ['db']);
  const model = JSON.parse((await compose(['config', '--format', 'json'])).stdout);
  assert.equal(model.name, project);
  assert.deepEqual(Object.keys(model.volumes), ['pgdata']);
  assert.equal(
    model.volumes.pgdata.name,
    `${project}_pgdata`,
    'Verification must not attach a shared volume'
  );
  assert.ok(!model.volumes.pgdata.external, 'Verification volume must not be external');
  for (const service of Object.values(model.services)) {
    for (const mount of service.volumes || []) {
      assert.equal(mount.type, 'volume', 'Verification must not use host bind mounts');
      assert.equal(mount.source, 'pgdata');
    }
  }
  safeProject = true;

  console.log(
    'Building a unique Linux runtime image (first build may download Node/dependencies).'
  );
  await compose(['build', 'api'], { timeout: 600000 });
  built = true;
  const meta = JSON.parse((await run(['image', 'inspect', image])).stdout)[0];
  assert.equal(meta.Config.User, 'node');
  assert.deepEqual(meta.Config.Cmd, ['node', 'src/server.js']);
  assert.ok(
    !meta.Config.Env.some((value) => /^(JWT_SECRET|DATABASE_URL)=/.test(value)),
    'Image must not contain runtime secrets'
  );
  await run([
    'run',
    '--rm',
    '--read-only',
    image,
    'node',
    '-e',
    `
    const fs = require('node:fs');
    if (process.getuid() === 0) throw Error('Root runtime');
    for (const file of ['.env', '.env.test', '.env.example', '.git', 'tests', 'coverage',
      'node_modules/jest', 'node_modules/nodemon', 'node_modules/eslint']) {
      if (fs.existsSync('/app/' + file)) throw Error('Forbidden runtime file: ' + file);
    }
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') throw Error('Source tests copied into image');
        if (entry.isDirectory()) walk(dir + '/' + entry.name);
      }
    }
    walk('/app/src');
    const bcrypt = require('bcrypt');
    if (!bcrypt.compareSync('docker1234', bcrypt.hashSync('docker1234', 4))) throw Error('Native bcrypt failed');
  `,
  ]);
  const invalid = await run(
    [
      'run',
      '--rm',
      '--read-only',
      '-e',
      'JWT_SECRET=short',
      '-e',
      'DATABASE_URL=postgres://fake:fake@127.0.0.1:1/unused',
      image,
    ],
    { allowFailure: true }
  );
  assert.notEqual(invalid.code, 0, 'Container must refuse a short secret');
  assert.match(invalid.stderr, /JWT_SECRET/);

  await verifyRenderStartup();

  console.log('Starting isolated PostgreSQL, one-off migrations and the API; waiting for health.');
  await compose(['up', '--no-build', '-d', '--wait', '--wait-timeout', '120']);
  const apiId = (await compose(['ps', '-q', 'api'])).stdout.trim();
  const container = JSON.parse((await run(['inspect', apiId])).stdout)[0];
  assert.equal(container.State.Health.Status, 'healthy');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  const migrationId = (await compose(['ps', '-a', '-q', 'migrate'])).stdout.trim();
  const migration = JSON.parse((await run(['inspect', migrationId])).stdout)[0];
  assert.equal(migration.State.ExitCode, 0);
  assert.equal(migration.State.Status, 'exited');
  assert.deepEqual((await call('GET', '/health')).body, { status: 'ok', database: 'up' });
  assert.equal((await fetch(`${base}/api/v1/docs/`)).status, 200);
  assert.equal((await call('GET', '/openapi.json')).body.openapi, '3.0.3');

  console.log(
    'Checking real container auth, money, loans, admin command, monitoring and log privacy.'
  );
  const owner = await person('docker-owner@example.com');
  const reviewer = await person('docker-reviewer@example.com');
  const source = (
    await call('POST', '/accounts', { token: owner.token, body: { type: 'savings' } })
  ).body.account;
  const destination = (
    await call('POST', '/accounts', { token: reviewer.token, body: { type: 'current' } })
  ).body.account;
  const funding = { accountId: source.id, amount: 10000000 };
  assert.equal(
    (
      await call('POST', '/transactions/deposit', {
        token: owner.token,
        body: funding,
        key: 'docker-deposit-key',
      })
    ).status,
    201
  );
  const replay = await call('POST', '/transactions/deposit', {
    token: owner.token,
    body: funding,
    key: 'docker-deposit-key',
  });
  assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await call('POST', '/transactions/transfer', {
          token: owner.token,
          body: {
            fromAccountId: source.id,
            toAccountNumber: destination.accountNumber,
            amount: 100,
          },
          key: `docker-transfer-${n}`,
        })
      ).status,
      201
    );
  const input = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
  const quote = await call('POST', '/loans/quote', { token: owner.token, body: input });
  assert.equal(quote.body.quote.emi, 888488);
  const application = await call('POST', '/loans/applications', {
    token: owner.token,
    body: input,
    key: 'docker-application-key',
  });
  assert.equal(application.status, 201);
  const applicationId = application.body.application.id;
  assert.equal(
    (await call('GET', `/loans/applications/${applicationId}`, { token: reviewer.token })).status,
    404
  );
  await compose(['exec', '-T', 'api', 'npm', 'run', 'make-admin', '--', reviewer.email]);
  assert.equal((await call('GET', '/admin/alerts', { token: reviewer.token })).status, 403);
  const login = await call('POST', '/auth/login', {
    body: { email: reviewer.email, password: reviewer.password },
  });
  assert.equal(login.status, 200);
  const adminToken = login.body.token;
  secrets.push(adminToken);
  const reviewBody = { decision: 'approved', reason: 'Docker verification review' };
  assert.equal(
    (
      await call('POST', `/admin/loan-applications/${applicationId}/review`, {
        token: adminToken,
        body: reviewBody,
      })
    ).status,
    200
  );
  const alerts = await call('GET', '/admin/alerts', {
    token: adminToken,
    cookie: 'day21-private-cookie-probe',
  });
  assert.equal(alerts.status, 200);
  assert.deepEqual(alerts.body.alerts.map((alert) => alert.ruleCode).sort(), [
    'LARGE_TRANSACTION',
    'RAPID_TRANSFERS',
  ]);
  assert.equal(
    (await call('GET', `/accounts/${source.id}`, { token: owner.token })).body.account.balance,
    9999500
  );
  const totals = await compose([
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'bank',
    '-d',
    'minibank',
    '-At',
    '-c',
    'SELECT (SELECT count(*) FROM pgmigrations), (SELECT sum(balance) FROM accounts), (SELECT count(*) FROM transactions)',
  ]);
  assert.equal(totals.stdout.trim(), '5|10000000|6');
  await pause(200);
  const logs = (await compose(['logs', '--no-color', 'api'])).stdout;
  assert.ok(logs.includes('[Redacted]'), 'Production logs should contain redaction markers');
  assert.ok(!logs.includes('day21-private-cookie-probe'), 'Cookie leaked into container logs');
  for (const secret of secrets)
    assert.ok(!logs.includes(secret), 'Credential leaked into container logs');

  console.log(
    'Recreating containers without deleting the volume; verifying persistence and repeatable migrations.'
  );
  await compose(['down']); // This unique project only; deliberately omit --volumes here.
  await compose(['up', '--no-build', '-d', '--wait', '--wait-timeout', '120']);
  assert.equal(
    (await call('GET', `/accounts/${source.id}`, { token: owner.token })).body.account.balance,
    9999500
  );
  assert.equal(
    (await call('GET', `/loans/applications/${applicationId}`, { token: owner.token })).body
      .application.status,
    'approved'
  );
  const migrations = await compose(['logs', '--no-color', 'migrate']);
  assert.match(migrations.stdout, /No migrations to run/);
  console.log(
    'PASS: image isolation, bcrypt, non-root runtime, Render bootstrap/restart/shutdown, health, migrations, API flows, redaction and persistence.'
  );
}

(async () => {
  let failed = false;
  try {
    await verify();
  } catch (error) {
    failed = true;
    console.error(scrub(error.message));
    if (cloudContainer) {
      const logs = await run(['logs', cloudContainer], { allowFailure: true }).catch(() => null);
      if (logs) console.error(scrub(logs.stdout + logs.stderr).slice(-8000));
    }
    const logs = await compose(['logs', '--no-color', 'api', 'migrate'], {
      allowFailure: true,
    }).catch(() => null);
    if (logs) console.error(scrub(logs.stdout).slice(-8000));
  } finally {
    if (cloudContainer) {
      // Only this invocation's uniquely named bootstrap container.
      await run(['rm', '-f', cloudContainer], { allowFailure: true }).catch(() => null);
    }
    // Name contains a fresh random suffix owned by this invocation, never the default project.
    if (safeProject) {
      const cleanup = await compose(['down', '--volumes', '--remove-orphans'], {
        allowFailure: true,
      }).catch(() => null);
      if (!cleanup || cleanup.code !== 0) {
        failed = true;
        console.error('Could not fully remove the isolated verification project.');
      }
    }
    if (built) {
      const removed = await run(['image', 'rm', image], { allowFailure: true }).catch(() => null);
      if (!removed || removed.code !== 0) {
        failed = true;
        console.error('Could not remove the isolated verification image tag.');
      }
    }
  }
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(scrub(error.message));
  process.exitCode = 1;
});
