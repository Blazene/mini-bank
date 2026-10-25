const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
const compose = YAML.parse(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'), {
  merge: true,
});

test('image uses Linux production dependencies, a separate runtime stage and direct non-root Node startup', () => {
  expect(dockerfile).toMatch(/FROM node:22-bookworm-slim AS dependencies/);
  expect(dockerfile).toMatch(/npm ci --omit=dev/);
  expect(dockerfile).toMatch(/FROM node:22-bookworm-slim AS runtime/);
  expect(dockerfile).toMatch(/COPY --from=dependencies \/app\/node_modules/);
  expect(dockerfile).toMatch(/^USER node$/m);
  expect(dockerfile).toContain('CMD ["node", "src/server.js"]');
  expect(dockerfile).not.toMatch(/COPY\s+\.\s+\./);
  expect(dockerfile).not.toMatch(/JWT_SECRET|DATABASE_URL/);
});
test('build context is allowlisted and excludes source tests and environment files', () => {
  expect(ignore.split('\n')).toContain('**');
  expect(ignore).toContain('!src/**');
  expect(ignore).toContain('src/**/__tests__/**');
  expect(ignore).not.toMatch(/^!.*(?:\.env|node_modules|\.git|coverage)/m);
});
test('API and migration job are opt-in; existing PostgreSQL volume and local workflow are preserved', () => {
  expect(compose.services.db.profiles).toBeUndefined();
  expect(compose.services.api.profiles).toEqual(['app']);
  expect(compose.services.migrate.profiles).toEqual(['app']);
  expect(compose.services.db.volumes).toEqual(['pgdata:/var/lib/postgresql/data']);
  expect(compose.volumes).toEqual({ pgdata: null });
  expect(compose.services.db.healthcheck.test).toContain('pg_isready -U bank -d minibank');
});
test('migration must finish after database readiness and before the API starts', () => {
  const { api, migrate } = compose.services;
  expect(migrate.depends_on.db.condition).toBe('service_healthy');
  expect(api.depends_on.migrate.condition).toBe('service_completed_successfully');
  expect(migrate.command).toEqual(['npm', 'run', 'migrate', '--', 'up']);
  expect(migrate.restart).toBe('no');
});
test('containers use service DNS, not the host .env DATABASE_URL or a baked-in JWT secret', () => {
  for (const name of ['api', 'migrate']) {
    expect(compose.services[name].environment.DATABASE_URL).toBe(
      'postgres://bank:bankpass@db:5432/minibank'
    );
  }
  expect(compose.services.api.environment.JWT_SECRET).toBe('${JWT_SECRET:-}');
  expect(compose.services.api.environment.NODE_ENV).toBe('production');
  expect(compose.services.api.environment.PORT).toBe(3000);
});
test('local-only ports and reduced runtime privileges are explicit', () => {
  expect(compose.services.api.ports).toEqual(['127.0.0.1:${API_PORT:-3000}:3000']);
  expect(compose.services.db.ports).toEqual(['127.0.0.1:${DB_PORT:-5432}:5432']);
  for (const name of ['api', 'migrate']) {
    const service = compose.services[name];
    expect(service.init).toBe(true);
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(['ALL']);
    expect(service.security_opt).toEqual(['no-new-privileges:true']);
    expect(service.tmpfs).toEqual(['/tmp:rw,noexec,nosuid,size=64m']);
  }
});
