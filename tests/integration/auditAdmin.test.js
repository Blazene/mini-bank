const { spawnSync } = require('child_process');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');
const { at } = require('../helpers/ledger');
const { flushAuditWrites } = require('../../src/modules/audit/audit.service');
const { grantAdmin } = require('../../scripts/make-admin');

const ENDPOINT = '/api/v1/admin/audit-logs';
const get = (token, query = '') =>
  request(app).get(`${ENDPOINT}${query}`).set('Authorization', `Bearer ${token}`);

const login = (email, password = 'secret123') =>
  request(app).post('/api/v1/auth/login').send({ email, password });

// An admin is made by the operator script, then logs in AGAIN to get a token that says so.
async function makeAdmin(email = 'admin@x.com') {
  const { user } = await registerAndLogin(email);
  await grantAdmin(email);
  const res = await login(email);
  return { token: res.body.token, user };
}

async function clearLog() {
  await flushAuditWrites();
  await pool.query('TRUNCATE audit_logs');
}

const txId = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed({
  id = null,
  userId = null,
  action = 'auth.login',
  outcome = 'failure',
  statusCode = 401,
  createdAt = at(1),
  metadata = {},
}) {
  const { rows } = await pool.query(
    `INSERT INTO audit_logs (id, user_id, action, outcome, status_code, ip_address, metadata, created_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, '10.0.0.1', $6, $7::timestamptz)
     RETURNING id`,
    [id, userId, action, outcome, statusCode, JSON.stringify(metadata), createdAt]
  );
  return rows[0].id;
}

const ids = (items) => items.map((item) => item.id);

async function walk(token, query = '') {
  const pages = [];
  let cursor = null;
  do {
    const sep = query ? '&' : '?';
    const res = await get(token, `${query}${cursor ? `${sep}cursor=${cursor}` : ''}`);
    expect(res.status).toBe(200);
    pages.push(res.body);
    cursor = res.body.pagination.nextCursor;
  } while (cursor);
  return pages;
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('who may read the log', () => {
  test('no token is a 401', async () => {
    const res = await request(app).get(ENDPOINT);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('a bad token is a 401', async () => {
    const res = await get('not-a-token');
    expect(res.status).toBe(401);
  });

  test('an ordinary user is a 403', async () => {
    const { token } = await registerAndLogin('user@x.com');
    const res = await get(token);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('an admin is let in', async () => {
    const { token } = await makeAdmin();
    expect((await get(token)).status).toBe(200);
  });

  test('a user cannot make themselves an admin when registering', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'sneaky@x.com', fullName: 'Sneaky', password: 'secret123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');

    const { body } = await login('sneaky@x.com');
    expect((await get(body.token)).status).toBe(403);
  });

  test('being made an admin takes effect at the NEXT login, because the role is inside the token', async () => {
    const { token: oldToken } = await registerAndLogin('soon@x.com');
    await grantAdmin('soon@x.com');

    expect((await get(oldToken)).status).toBe(403);
    const fresh = await login('soon@x.com');
    expect((await get(fresh.body.token)).status).toBe(200);
  });

  test('the error for a non-admin gives nothing away about the log', async () => {
    const { token } = await registerAndLogin('user@x.com');
    const res = await get(token);
    expect(res.body).toEqual({
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
  });
});

describe('what the endpoint returns', () => {
  test('each entry has exactly the documented fields', async () => {
    const { token, user } = await makeAdmin();
    await clearLog();
    await seed({ userId: user.id, createdAt: at(5), metadata: { email: 'a@x.com' } });

    const res = await get(token);
    expect(res.body.logs).toHaveLength(1);
    expect(Object.keys(res.body.logs[0]).sort()).toEqual(
      [
        'action',
        'createdAt',
        'id',
        'ipAddress',
        'metadata',
        'outcome',
        'statusCode',
        'userId',
      ].sort()
    );
    expect(res.body.logs[0]).toMatchObject({
      userId: user.id,
      action: 'auth.login',
      outcome: 'failure',
      statusCode: 401,
      ipAddress: '10.0.0.1',
      metadata: { email: 'a@x.com' },
      createdAt: '2026-10-01T00:00:05.000Z',
    });
  });

  test('shows the whole log: every user, not just the admin', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    const u1 = await registerAndLogin('u1@x.com');
    const u2 = await registerAndLogin('u2@x.com');
    await flushAuditWrites();

    const res = await get(token, '?action=auth.login&outcome=success');
    expect(res.body.logs.map((l) => l.userId).sort()).toEqual([u1.user.id, u2.user.id].sort());
  });

  test('an empty log is an empty list, not an error', async () => {
    const { token } = await makeAdmin();
    await clearLog();

    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      logs: [],
      pagination: { limit: 20, hasMore: false, nextCursor: null },
    });
  });

  test('newest first', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    for (const s of [3, 1, 2]) await seed({ createdAt: at(s), metadata: { s } });

    const res = await get(token);
    expect(res.body.logs.map((l) => l.metadata.s)).toEqual([3, 2, 1]);
  });

  test("the admin's own reading of the log is not added to it", async () => {
    const { token } = await makeAdmin();
    await clearLog();
    await get(token);
    await get(token);

    await flushAuditWrites();
    const { rows } = await pool.query('SELECT count(*) FROM audit_logs');
    expect(rows[0].count).toBe('0');
  });
});

describe('filters', () => {
  async function mixed() {
    const { token, user } = await makeAdmin();
    await clearLog();
    const other = await registerAndLogin('other@x.com');
    await clearLog();
    await seed({
      userId: user.id,
      action: 'auth.login',
      outcome: 'success',
      statusCode: 200,
      createdAt: at(10),
      metadata: { n: 1 },
    });
    await seed({
      userId: null,
      action: 'auth.login',
      outcome: 'failure',
      statusCode: 401,
      createdAt: at(20),
      metadata: { n: 2 },
    });
    await seed({
      userId: other.user.id,
      action: 'transaction.transfer',
      outcome: 'failure',
      statusCode: 404,
      createdAt: at(30),
      metadata: { n: 3 },
    });
    await seed({
      userId: other.user.id,
      action: 'transaction.transfer',
      outcome: 'success',
      statusCode: 201,
      createdAt: at(40),
      metadata: { n: 4 },
    });
    return { token, admin: user, other: other.user };
  }
  const n = (res) => res.body.logs.map((l) => l.metadata.n);

  test('by action', async () => {
    const { token } = await mixed();
    expect(n(await get(token, '?action=transaction.transfer'))).toEqual([4, 3]);
    expect(n(await get(token, '?action=auth.login'))).toEqual([2, 1]);
  });

  test('by outcome', async () => {
    const { token } = await mixed();
    expect(n(await get(token, '?outcome=failure'))).toEqual([3, 2]);
    expect(n(await get(token, '?outcome=success'))).toEqual([4, 1]);
  });

  test('by user', async () => {
    const { token, other } = await mixed();
    expect(n(await get(token, `?userId=${other.id}`))).toEqual([4, 3]);
  });

  test('from includes the moment, to excludes it', async () => {
    const { token } = await mixed();
    const t = (s) => encodeURIComponent(`2026-10-01T00:00:${s}Z`);
    expect(n(await get(token, `?from=${t(20)}`))).toEqual([4, 3, 2]);
    expect(n(await get(token, `?to=${t(30)}`))).toEqual([2, 1]);
    expect(n(await get(token, `?from=${t(20)}&to=${t(40)}`))).toEqual([3, 2]);
  });

  test('filters combine', async () => {
    const { token, other } = await mixed();
    const res = await get(token, `?userId=${other.id}&outcome=failure&action=transaction.transfer`);
    expect(n(res)).toEqual([3]);
  });

  test('a filter that matches nothing is an empty list', async () => {
    const { token } = await mixed();
    const res = await get(token, '?action=admin.role_granted');
    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual([]);
  });

  test('the role cannot be filtered or smuggled in through the query', async () => {
    const { token } = await mixed();
    const res = await get(token, '?role=admin&password=x');
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(4);
  });
});

describe('pagination', () => {
  async function seedMany(count) {
    const created = [];
    for (let k = 1; k <= count; k += 1) {
      created.push(await seed({ id: txId(k), createdAt: at(k), metadata: { k } }));
    }
    return created.reverse();
  }

  test('defaults to 20 per page', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    await seedMany(25);

    const res = await get(token);
    expect(res.body.logs).toHaveLength(20);
    expect(res.body.pagination).toMatchObject({ limit: 20, hasMore: true });
  });

  test('walking every page returns every row once, in order', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    const expected = await seedMany(25);

    const pages = await walk(token, '?limit=10');
    expect(pages.map((p) => p.logs.length)).toEqual([10, 10, 5]);
    expect(pages.map((p) => p.pagination.hasMore)).toEqual([true, true, false]);
    expect(pages.flatMap((p) => ids(p.logs))).toEqual(expected);
  });

  test('exactly one full page means no next page', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    await seedMany(10);

    const res = await get(token, '?limit=10');
    expect(res.body.pagination).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });

  test('rows with identical timestamps across a page boundary are neither skipped nor repeated', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    const expected = [];
    for (let k = 7; k >= 1; k -= 1) expected.push(await seed({ id: txId(k), createdAt: at(1) }));

    const pages = await walk(token, '?limit=3');
    expect(pages.flatMap((p) => ids(p.logs))).toEqual(expected);
  });

  test('rows that differ only in microseconds are not lost at a page boundary', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    const expected = [];
    for (let k = 6; k >= 1; k -= 1) expected.push(await seed({ id: txId(k), createdAt: at(1, k) }));

    const pages = await walk(token, '?limit=2');
    expect(pages.flatMap((p) => ids(p.logs))).toEqual(expected);
  });

  test('a new row at the top between two requests does not shift the next page', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    await seedMany(6);

    const page1 = await get(token, '?limit=2');
    await seed({ id: txId(99), createdAt: at(50), metadata: { k: 99 } });
    const page2 = await get(token, `?limit=2&cursor=${page1.body.pagination.nextCursor}`);

    expect(page1.body.logs.map((l) => l.metadata.k)).toEqual([6, 5]);
    expect(page2.body.logs.map((l) => l.metadata.k)).toEqual([4, 3]);
  });

  test('the cursor works together with filters', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    for (let k = 1; k <= 6; k += 1) {
      await seed({ createdAt: at(k), outcome: 'failure', metadata: { k } });
      await seed({
        createdAt: at(k, 500),
        outcome: 'success',
        statusCode: 200,
        metadata: { k: 100 + k },
      });
    }

    const pages = await walk(token, '?outcome=failure&limit=4');
    expect(pages.flatMap((p) => p.logs.map((l) => l.metadata.k))).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

describe('bad parameters are a clean 400', () => {
  const bad = [
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=abc', 'limit'],
    ['action=login', 'action'],
    ['action=', 'action'],
    ['outcome=ok', 'outcome'],
    ['userId=nope', 'userId'],
    ['from=yesterday', 'from'],
    ['from=2026-02-30T00:00:00Z', 'from'],
    ['from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z', 'from'],
    ['cursor=garbage', 'cursor'],
  ];

  for (const [query, field] of bad) {
    test(`?${query}`, async () => {
      const { token } = await makeAdmin();
      const res = await get(token, `?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.field)).toContain(field);
    });
  }

  test('a non-admin with bad parameters still gets 403, not a 400 that reveals the rules', async () => {
    const { token } = await registerAndLogin('user@x.com');
    expect((await get(token, '?limit=zzz')).status).toBe(403);
  });
});

describe('the query uses an index', () => {
  test('listing the newest rows reads through audit_logs_created_idx, in a fully fixed order', async () => {
    const { token } = await makeAdmin();
    await clearLog();
    await seed({});

    const spy = jest.spyOn(pool, 'query');
    await get(token, '?limit=5');
    const call = spy.mock.calls.find(([text]) => /FROM audit_logs/.test(text));
    spy.mockRestore();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${call[0]}`, call[1]);
      const plan = JSON.stringify(rows[0]['QUERY PLAN']);
      expect(plan).toContain('audit_logs_created_idx');
      expect(plan).not.toContain('Seq Scan');
      // The index happens to return rows in this order already, but only the explicit ORDER BY
      // guarantees it. Without the id, rows with the same timestamp have no fixed order.
      expect(call[0]).toMatch(/ORDER BY created_at DESC, id DESC\s+LIMIT/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('the make-admin tool', () => {
  test('gives an existing user the admin role', async () => {
    await registerAndLogin('a@x.com');
    const user = await grantAdmin('a@x.com');

    expect(user).toMatchObject({ email: 'a@x.com', role: 'admin' });
    const { rows } = await pool.query(`SELECT role FROM users WHERE email = 'a@x.com'`);
    expect(rows[0].role).toBe('admin');
  });

  test('matches the email in any letter case', async () => {
    await registerAndLogin('a@x.com');
    expect((await grantAdmin('A@X.COM')).role).toBe('admin');
  });

  test('records that it happened in the audit log', async () => {
    const { user } = await registerAndLogin('a@x.com');
    await clearLog();
    await grantAdmin('a@x.com');

    const { rows } = await pool.query('SELECT * FROM audit_logs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: user.id,
      action: 'admin.role_granted',
      outcome: 'success',
      metadata: { email: 'a@x.com', via: 'make-admin script' },
    });
  });

  test('an email nobody has returns null and writes nothing', async () => {
    await clearLog();
    expect(await grantAdmin('ghost@x.com')).toBeNull();

    const { rows } = await pool.query('SELECT count(*) FROM audit_logs');
    expect(rows[0].count).toBe('0');
  });

  test('can be filtered for in the endpoint', async () => {
    const { token } = await makeAdmin();
    const res = await get(token, '?action=admin.role_granted');
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].metadata.email).toBe('admin@x.com');
  });

  describe('run as a command', () => {
    const run = (...args) =>
      spawnSync('node', [path.join(__dirname, '../../scripts/make-admin.js'), ...args], {
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf8',
      });

    test('promotes the user and says they must log in again', async () => {
      await registerAndLogin('cli@x.com');
      const result = run('cli@x.com');

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/cli@x.com is now an admin/);
      expect(result.stdout).toMatch(/log in again/);
      const { rows } = await pool.query(`SELECT role FROM users WHERE email = 'cli@x.com'`);
      expect(rows[0].role).toBe('admin');
    });

    test('an unknown email exits with an error', () => {
      const result = run('ghost@x.com');
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/No user with the email ghost@x.com/);
    });

    test('no email prints the usage and exits with an error', () => {
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Usage: npm run make-admin/);
    });
  });
});
