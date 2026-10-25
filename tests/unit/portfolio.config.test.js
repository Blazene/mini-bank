const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('private environment variants are ignored while explicit nonsecret templates remain versionable', () => {
  const patterns = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n');
  expect(patterns).toContain('.env');
  expect(patterns).toContain('.env.*');
  expect(patterns.indexOf('!.env.example')).toBeGreaterThan(patterns.indexOf('.env.*'));
  expect(patterns.indexOf('!.env.test')).toBeGreaterThan(patterns.indexOf('.env.*'));
});

test('the public demo checker is explicit and is not an application/test/deployment startup hook', () => {
  const pkg = require('../../package.json');
  expect(pkg.scripts['verify:demo']).toBe('node scripts/verify-demo.js');
  for (const key of ['start', 'pretest', 'test', 'migrate']) {
    expect(pkg.scripts[key]).not.toContain('verify-demo');
  }
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  expect(dockerfile).not.toContain('COPY scripts/verify-demo.js');
});
