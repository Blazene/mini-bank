const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const workflow = YAML.parse(source);
const updates = YAML.parse(fs.readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'));
const pkg = require('../../package.json');
const jobs = Object.values(workflow.jobs);
const steps = jobs.flatMap((job) => job.steps);

test('CI covers main pushes, all pull requests and manual runs without privileged PR execution', () => {
  expect(workflow.name).toBe('CI');
  expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  expect(workflow.on.push.branches).toEqual(['main']);
  expect(workflow.on.pull_request).toEqual({});
  expect(workflow.on.pull_request_target).toBeUndefined();
  expect(workflow.on.push.paths).toBeUndefined();
});

test('tokens are read-only, checkout credentials are not persisted and no repository secrets are needed', () => {
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(source).not.toMatch(/\bsecrets\./);
  for (const step of steps.filter(
    (step) => step.uses && step.uses.startsWith('actions/checkout@')
  )) {
    expect(step.with['persist-credentials']).toBe(false);
  }
  for (const job of jobs) expect(job.permissions).toBeUndefined();
});

test('only official actions are used, pinned to full commit SHAs', () => {
  const allowed = ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact'];
  for (const step of steps.filter((step) => step.uses)) {
    const [name, revision] = step.uses.split('@');
    expect(allowed).toContain(name);
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
  }
});

test('jobs use Node 22 and lockfile caching, not cached host node_modules', () => {
  const setup = steps.filter((step) => step.uses && step.uses.startsWith('actions/setup-node@'));
  expect(setup).toHaveLength(3);
  for (const step of setup) {
    expect(step.with).toEqual({
      'node-version': '22',
      cache: 'npm',
      'cache-dependency-path':
        step.with['cache-dependency-path'] === 'frontend/package-lock.json'
          ? 'frontend/package-lock.json'
          : 'package-lock.json',
    });
  }
  for (const job of jobs) {
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(job.steps).toContainEqual(expect.objectContaining({ run: 'npm ci' }));
    expect(job['continue-on-error']).toBeUndefined();
  }
  expect(steps.every((step) => step['continue-on-error'] === undefined)).toBe(true);
});

test('PostgreSQL service, test env and migration command agree on a guarded test database', () => {
  const job = workflow.jobs.test;
  const service = job.services.postgres;
  const testEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.test')));
  expect(job.env.NODE_ENV).toBe('test');
  expect(job.env.DATABASE_URL).toBe(testEnv.DATABASE_URL);
  expect(pkg.scripts['migrate:test']).toContain(`DATABASE_URL=${job.env.DATABASE_URL} `);
  expect(pkg.scripts.pretest).toBe('npm run migrate:test');
  expect(pkg.scripts.test).toContain('--coverage');
  const url = new URL(job.env.DATABASE_URL);
  expect(url.pathname.endsWith('_test')).toBe(true);
  expect(service.image).toBe('postgres:16');
  expect(service.env).toEqual({
    POSTGRES_USER: url.username,
    POSTGRES_PASSWORD: url.password,
    POSTGRES_DB: url.pathname.slice(1),
  });
  expect(service.ports).toEqual(['5432:5432']);
  expect(service.options).toContain('pg_isready -U bank -d minibank_test');
  expect(job.env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  expect(job.env.BCRYPT_ROUNDS).toBe('4');
  expect(job.env.RATE_LIMIT_ENABLED).toBe('false');
});

test('lint, full tests and high-severity audit are enforced in order', () => {
  const commands = workflow.jobs.test.steps.filter((step) => step.run).map((step) => step.run);
  expect(commands).toEqual(['npm ci', 'npm run lint', 'npm test', 'npm audit --audit-level=high']);
  expect(workflow.jobs.docker.needs).toBe('test');
  expect(workflow.jobs.docker.steps).toContainEqual(
    expect.objectContaining({ run: 'npm run test:docker' })
  );
  expect(workflow.jobs.docker.services).toBeUndefined();
});

test('coverage artifacts are bounded to reports and retained after failed non-cancelled runs', () => {
  const upload = steps.find(
    (step) => step.uses && step.uses.startsWith('actions/upload-artifact@')
  );
  expect(upload.if).toBe('${{ !cancelled() }}');
  expect(upload.with).toEqual({
    name: 'coverage-node22',
    path: 'coverage/',
    'retention-days': 7,
    'if-no-files-found': 'warn',
    'include-hidden-files': false,
  });
});

test('timeouts and concurrency prevent indefinitely hanging or superseded runs', () => {
  expect(workflow.concurrency).toEqual({
    group: 'ci-${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': true,
  });
  expect(workflow.jobs.test['timeout-minutes']).toBe(15);
  expect(workflow.jobs.docker['timeout-minutes']).toBe(20);
});

test('Dependabot schedules npm, action pins and Docker base updates without automerging them', () => {
  expect(updates.version).toBe(2);
  expect(updates.updates.map((entry) => entry['package-ecosystem']).sort()).toEqual([
    'docker',
    'github-actions',
    'npm',
    'npm',
  ]);
  for (const entry of updates.updates) {
    expect(['/', '/frontend']).toContain(entry.directory);
    expect(entry.schedule.interval).toBe('weekly');
    expect(entry['open-pull-requests-limit']).toBe(5);
  }
});

test('frontend checks are isolated, lockfile-cached, and never run against cloud data', () => {
  const job = workflow.jobs.frontend;
  expect(job.defaults.run['working-directory']).toBe('frontend');
  expect(job['timeout-minutes']).toBe(15);
  expect(job.services).toBeUndefined();
  expect(job.needs).toBeUndefined();
  const setup = job.steps.find((step) => step.uses && step.uses.startsWith('actions/setup-node@'));
  expect(setup.with['cache-dependency-path']).toBe('frontend/package-lock.json');
  expect(job.steps.filter((step) => step.run).map((step) => step.run)).toEqual([
    'npm ci',
    'npm test',
    'npm run build',
    'npm audit --audit-level=high',
    'npx playwright install --with-deps chromium',
    'npm run test:e2e',
  ]);
  expect(
    updates.updates
      .filter((entry) => entry['package-ecosystem'] === 'npm')
      .map((entry) => entry.directory)
      .sort()
  ).toEqual(['/', '/frontend']);
  const config = require('../../jest.config');
  expect(config.testPathIgnorePatterns).toContain('/frontend/');
  expect(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')).toContain(
    'COPY --from=frontend /web/dist ./public'
  );
});
