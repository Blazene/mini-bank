const request = require('supertest');
const app = require('../../src/app');
const env = require('../../src/config/env');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');
const { LIMITS, resetRateLimits } = require('../../src/shared/middleware/rateLimit');

// The rest of the test suite runs with limiting OFF (.env.test), so it never collides with
// these limits. Each test here sets its people up with limiting off, then switches it on.
const limitingOn = () => {
  resetRateLimits();
  env.RATE_LIMIT_ENABLED = true;
};

const login = (email, password = 'secret123') =>
  request(app).post('/api/v1/auth/login').send({ email, password });

const register = (n) =>
  request(app)
    .post('/api/v1/auth/register')
    .send({ email: `new${n}@x.com`, fullName: 'New Person', password: 'secret123' });

let keyCounter = 0;
const transfer = (token, body) =>
  request(app)
    .post('/api/v1/transactions/transfer')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `rate-limit-key-${(keyCounter += 1)}`)
    .send(body);

// A logged-in user with one funded account. The account number is 100000000000 plus n.
async function sender(n, balance = 100000) {
  const { token, user } = await registerAndLogin(`sender${n}@x.com`);
  const account = await createAccount(user.id, String(100000000000 + n), balance);
  return { token, user, account };
}

const MISSING_NUMBER = '999999999999';

beforeEach(async () => {
  env.RATE_LIMIT_ENABLED = false;
  resetRateLimits();
  await resetDb();
});

afterEach(() => {
  env.RATE_LIMIT_ENABLED = false;
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('the 429 answer', () => {
  test('has the usual error shape, a Retry-After header and RateLimit headers', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();
    for (let n = 0; n < LIMITS.loginEmail.limit; n += 1) await login('a@x.com', 'wrong-pass1');

    const res = await login('a@x.com', 'wrong-pass1');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.stringMatching(/too many requests/i) },
    });

    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LIMITS.loginEmail.windowMs / 1000);
    expect(res.headers.ratelimit).toMatch(/remaining=0/);
  });

  test('normal answers show how much room is left', async () => {
    limitingOn();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['ratelimit-policy']).toBe(`${LIMITS.api.limit};w=60`);
    expect(res.headers.ratelimit).toMatch(
      `limit=${LIMITS.api.limit}, remaining=${LIMITS.api.limit - 1}`
    );
  });
});

describe('switching limiting off', () => {
  test('RATE_LIMIT_ENABLED=false lets any number of failed logins through', async () => {
    await registerAndLogin('a@x.com');
    for (let n = 0; n < LIMITS.loginEmail.limit + 5; n += 1) {
      expect((await login('a@x.com', 'wrong-pass1')).status).toBe(401);
    }
  });
});

describe('login: per email', () => {
  test('after 5 wrong passwords the 6th attempt is refused with 429', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();

    for (let n = 0; n < 5; n += 1) {
      expect((await login('a@x.com', 'wrong-pass1')).status).toBe(401);
    }
    expect((await login('a@x.com', 'wrong-pass1')).status).toBe(429);
  });

  test('the CORRECT password is refused too once the limit is reached', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();
    for (let n = 0; n < 5; n += 1) await login('a@x.com', 'wrong-pass1');

    expect((await login('a@x.com', 'secret123')).status).toBe(429);
  });

  test('a different email is not affected', async () => {
    await registerAndLogin('a@x.com');
    await registerAndLogin('b@x.com');
    limitingOn();
    for (let n = 0; n < 6; n += 1) await login('a@x.com', 'wrong-pass1');

    expect((await login('b@x.com', 'secret123')).status).toBe(200);
  });

  test('an email that does not exist is limited in exactly the same way', async () => {
    await registerAndLogin('real@x.com');
    limitingOn();

    const statuses = async (email) => {
      const seen = [];
      for (let n = 0; n < 7; n += 1) seen.push((await login(email, 'wrong-pass1')).status);
      return seen;
    };
    const known = await statuses('real@x.com');
    const unknown = await statuses('ghost@x.com');

    expect(known).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect(unknown).toEqual(known);
  });

  test('capital letters and spaces do not give extra tries (A@x.com is a@x.com)', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();
    for (const email of ['A@X.COM', ' a@x.com ', 'a@x.com', 'A@x.com', 'a@X.com']) {
      expect((await login(email, 'wrong-pass1')).status).toBe(401);
    }
    expect((await login('a@x.com', 'wrong-pass1')).status).toBe(429);
  });

  test('successful logins are never counted, more than either login limit would allow', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();
    for (let n = 0; n < LIMITS.loginIp.limit + 5; n += 1) {
      expect((await login('a@x.com', 'secret123')).status).toBe(200);
    }
  });

  test('requests that fail validation do not use up the email limit', async () => {
    await registerAndLogin('a@x.com');
    limitingOn();
    for (let n = 0; n < 8; n += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'a@x.com', password: '' });
      expect(res.status).toBe(400);
    }
    expect((await login('a@x.com', 'secret123')).status).toBe(200);
  });
});

describe('login: per IP address', () => {
  test('30 failed logins across different emails, then the 31st is refused', async () => {
    limitingOn();
    for (let n = 1; n <= LIMITS.loginIp.limit; n += 1) {
      expect((await login(`guess${n}@x.com`, 'wrong-pass1')).status).toBe(401);
    }
    expect((await login('guess31@x.com', 'wrong-pass1')).status).toBe(429);
  });

  test('a faked X-Forwarded-For header does not buy a fresh allowance', async () => {
    // TRUST_PROXY is 0, so the header must be ignored and the real socket address used.
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    limitingOn();
    let last;
    for (let n = 1; n <= LIMITS.loginIp.limit + 1; n += 1) {
      last = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${n}`)
        .send({ email: `spoof${n}@x.com`, password: 'wrong-pass1' });
    }
    quiet.mockRestore();
    expect(last.status).toBe(429);
  });
});

describe('register', () => {
  test('10 sign-ups from one IP address, then the 11th is refused', async () => {
    limitingOn();
    for (let n = 1; n <= LIMITS.register.limit; n += 1) {
      expect((await register(n)).status).toBe(201);
    }
    expect((await register(11)).status).toBe(429);
  });

  test('failed sign-ups count too (a duplicate email is still a try)', async () => {
    await registerAndLogin('taken@x.com');
    limitingOn();
    const statuses = [];
    for (let n = 0; n < 11; n += 1) {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'taken@x.com', fullName: 'Someone', password: 'secret123' });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([...Array(10).fill(409), 429]);
  });
});

describe('transfers: per user', () => {
  test('20 transfers a minute, then the 21st is refused', async () => {
    const a = await sender(1);
    const b = await sender(2, 0);
    limitingOn();

    for (let n = 0; n < LIMITS.transfer.limit; n += 1) {
      const res = await transfer(a.token, {
        fromAccountId: a.account.id,
        toAccountNumber: b.account.account_number,
        amount: 1,
      });
      expect(res.status).toBe(201);
    }
    const res = await transfer(a.token, {
      fromAccountId: a.account.id,
      toAccountNumber: b.account.account_number,
      amount: 1,
    });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  test("one user's limit does not slow down another user on the same IP address", async () => {
    const a = await sender(1);
    const b = await sender(2);
    const c = await sender(3, 0);
    limitingOn();

    for (let n = 0; n <= LIMITS.transfer.limit; n += 1) {
      await transfer(a.token, {
        fromAccountId: a.account.id,
        toAccountNumber: c.account.account_number,
        amount: 1,
      });
    }
    const res = await transfer(b.token, {
      fromAccountId: b.account.id,
      toAccountNumber: c.account.account_number,
      amount: 1,
    });
    expect(res.status).toBe(201);
  });

  test('a transfer with no token is a 401 and does not touch any user counter', async () => {
    limitingOn();
    const res = await request(app)
      .post('/api/v1/transactions/transfer')
      .set('Idempotency-Key', 'rate-limit-key-anon')
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('transfers: probing for account numbers', () => {
  const probe = (user, number = MISSING_NUMBER) =>
    transfer(user.token, {
      fromAccountId: user.account.id,
      toAccountNumber: number,
      amount: 1,
    });

  test('10 transfers to numbers that do not exist, then the 11th is refused', async () => {
    const a = await sender(1);
    limitingOn();

    for (let n = 0; n < LIMITS.transferMiss.limit; n += 1) {
      expect((await probe(a)).status).toBe(404);
    }
    expect((await probe(a)).status).toBe(429);
  });

  test('once blocked, even a transfer to a real account is refused for a while', async () => {
    const a = await sender(1);
    const b = await sender(2, 0);
    limitingOn();
    for (let n = 0; n < LIMITS.transferMiss.limit; n += 1) await probe(a);

    expect((await probe(a, b.account.account_number)).status).toBe(429);
  });

  test('successful transfers do not count as probes', async () => {
    const a = await sender(1);
    const b = await sender(2, 0);
    limitingOn();

    for (let n = 0; n < 15; n += 1) {
      expect((await probe(a, b.account.account_number)).status).toBe(201);
    }
    expect((await probe(a)).status).toBe(404);
  });

  test('refusals that are not "not found" (such as insufficient funds) are not probes either', async () => {
    const a = await sender(1, 0);
    const b = await sender(2, 0);
    limitingOn();

    for (let n = 0; n < 12; n += 1) {
      expect((await probe(a, b.account.account_number)).status).toBe(422);
    }
    expect((await probe(a)).status).toBe(404);
  });

  test("another user's probing does not affect you", async () => {
    const a = await sender(1);
    const b = await sender(2);
    limitingOn();
    for (let n = 0; n <= LIMITS.transferMiss.limit; n += 1) await probe(a);

    expect((await probe(b)).status).toBe(404);
  });
});

describe('every route: per IP address', () => {
  test('300 requests a minute, then 429', async () => {
    limitingOn();
    for (let n = 0; n < LIMITS.api.limit; n += 1) {
      const res = await request(app).get('/api/v1/auth/me');
      if (res.status !== 401) throw new Error(`request ${n + 1} gave ${res.status}`);
    }
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  test('/health is never limited, so a load balancer check cannot be locked out', async () => {
    limitingOn();
    for (let n = 0; n < LIMITS.api.limit + 5; n += 1) await request(app).get('/api/v1/auth/me');

    expect((await request(app).get('/api/v1/auth/me')).status).toBe(429);
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });

  test('unknown routes are limited as well (scanning for paths costs requests)', async () => {
    limitingOn();
    for (let n = 0; n < LIMITS.api.limit; n += 1) await request(app).get('/api/v1/nope');
    expect((await request(app).get('/api/v1/nope')).status).toBe(429);
  });
});
