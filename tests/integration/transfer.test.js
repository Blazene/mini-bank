const request = require('supertest');
const app = require('../../src/app');
const transactionsRepository = require('../../src/modules/transactions/transactions.repository');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');

let keyCounter = 0;
function transfer(token, body, key) {
  return request(app)
    .post('/api/v1/transactions/transfer')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key || `transfer-key-${(keyCounter += 1)}`)
    .send(body);
}

// One person with one account. The 12-digit account number is 100000000000 plus n.
async function party(n, balance) {
  const { token, user } = await registerAndLogin(`user${n}@x.com`);
  const number = String(100000000000 + n);
  const account = await createAccount(user.id, number, balance);
  return { token, user, account, number };
}

const body = (from, to, amount, extra = {}) => ({
  fromAccountId: from.account.id,
  toAccountNumber: to.number,
  amount,
  ...extra,
});

const balanceOf = async (id) =>
  Number((await pool.query('SELECT balance FROM accounts WHERE id = $1', [id])).rows[0].balance);

const ledger = async () =>
  (await pool.query('SELECT * FROM transactions ORDER BY created_at, id')).rows;

const KEY = 'retry-transfer-0001';

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('POST /transactions/transfer', () => {
  test('moves money from one account to another and records one transfer', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    const res = await transfer(a.token, body(a, b, 250, { description: 'rent' }));

    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({
      type: 'transfer',
      amount: 250,
      fromAccountId: a.account.id,
      toAccountId: b.account.id,
      status: 'completed',
      description: 'rent',
    });
    expect(res.body.account.id).toBe(a.account.id);
    expect(res.body.account.balance).toBe(750);

    expect(await balanceOf(a.account.id)).toBe(750);
    expect(await balanceOf(b.account.id)).toBe(650);

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('transfer');
    expect(rows[0].from_account_id).toBe(a.account.id);
    expect(rows[0].to_account_id).toBe(b.account.id);
  });

  test('works between two accounts of the same person', async () => {
    const a = await party(1, 1000);
    const second = await createAccount(a.user.id, '100000000099', 0);
    const res = await transfer(a.token, {
      fromAccountId: a.account.id,
      toAccountNumber: '100000000099',
      amount: 300,
    });

    expect(res.status).toBe(201);
    expect(await balanceOf(a.account.id)).toBe(700);
    expect(await balanceOf(second.id)).toBe(300);
  });

  test('refuses to overdraw: 422, both balances unchanged, nothing recorded', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    const res = await transfer(a.token, body(a, b, 1001));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await balanceOf(b.account.id)).toBe(400);
    expect(await ledger()).toHaveLength(0);
  });

  test('allows transferring exactly the whole balance', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);
    const res = await transfer(a.token, body(a, b, 1000));

    expect(res.status).toBe(201);
    expect(await balanceOf(a.account.id)).toBe(0);
    expect(await balanceOf(b.account.id)).toBe(1000);
  });

  test('cannot move money out of someone else account', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 5000);
    const res = await transfer(a.token, {
      fromAccountId: b.account.id,
      toAccountNumber: a.number,
      amount: 100,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(b.account.id)).toBe(5000);
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test('answers 404 for an account number that does not exist', async () => {
    const a = await party(1, 1000);
    const res = await transfer(a.token, {
      fromAccountId: a.account.id,
      toAccountNumber: '999999999999',
      amount: 100,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DESTINATION_NOT_FOUND');
    expect(await balanceOf(a.account.id)).toBe(1000);
  });

  test.each(['frozen', 'closed'])(
    'answers a %s destination exactly like a missing one',
    async (status) => {
      const a = await party(1, 1000);
      const b = await party(2, 400);
      await pool.query('UPDATE accounts SET status = $1 WHERE id = $2', [status, b.account.id]);

      const frozen = await transfer(a.token, body(a, b, 100));
      const missing = await transfer(a.token, {
        fromAccountId: a.account.id,
        toAccountNumber: '999999999999',
        amount: 100,
      });

      expect(frozen.status).toBe(404);
      expect(frozen.body).toEqual(missing.body);
      expect(await balanceOf(a.account.id)).toBe(1000);
      expect(await balanceOf(b.account.id)).toBe(400);
      expect(await ledger()).toHaveLength(0);
    }
  );

  test.each(['frozen', 'closed'])('refuses a %s source account', async (status) => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    await pool.query('UPDATE accounts SET status = $1 WHERE id = $2', [status, a.account.id]);
    const res = await transfer(a.token, body(a, b, 100));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await balanceOf(b.account.id)).toBe(400);
  });

  test('refuses a transfer to the same account', async () => {
    const a = await party(1, 1000);
    const res = await transfer(a.token, body(a, a, 100));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SAME_ACCOUNT_TRANSFER');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await ledger()).toHaveLength(0);
  });

  test('refuses a transfer to the same account even if the id is sent in capitals', async () => {
    const a = await party(1, 1000);
    const res = await transfer(a.token, {
      fromAccountId: a.account.id.toUpperCase(),
      toAccountNumber: a.number,
      amount: 100,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SAME_ACCOUNT_TRANSFER');
  });

  test('refuses a credit that would push the destination past the safe limit', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 9007199254740000);
    const res = await transfer(a.token, body(a, b, 1000));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await balanceOf(b.account.id)).toBe(9007199254740000);
  });

  test.each([
    ['a source id that is not a UUID', { fromAccountId: '123' }],
    ['an account number that is too short', { toAccountNumber: '12345' }],
    ['an account number with letters', { toAccountNumber: '10000000000a' }],
    ['a zero amount', { amount: 0 }],
    ['a negative amount', { amount: -5 }],
    ['a decimal amount', { amount: 10.5 }],
    ['a string amount', { amount: '100' }],
    ['an amount above the cap', { amount: 1000000001 }],
  ])('rejects %s and changes nothing', async (label, overrides) => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    const res = await transfer(a.token, { ...body(a, b, 100), ...overrides });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await balanceOf(b.account.id)).toBe(400);
    expect(await ledger()).toHaveLength(0);
  });

  test('needs a token', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    const res = await request(app)
      .post('/api/v1/transactions/transfer')
      .set('Idempotency-Key', KEY)
      .send(body(a, b, 100));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
    expect(await balanceOf(a.account.id)).toBe(1000);
  });

  test('needs an Idempotency-Key', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    const res = await request(app)
      .post('/api/v1/transactions/transfer')
      .set('Authorization', `Bearer ${a.token}`)
      .send(body(a, b, 100));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await balanceOf(a.account.id)).toBe(1000);
  });

  test('rolls BOTH balances back if the ledger write fails half way', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 400);
    jest.spyOn(transactionsRepository, 'insert').mockRejectedValueOnce(new Error('ledger down'));

    const res = await transfer(a.token, body(a, b, 250));

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(await balanceOf(a.account.id)).toBe(1000);
    expect(await balanceOf(b.account.id)).toBe(400);
    expect(await ledger()).toHaveLength(0);
  });
});

describe('retrying a transfer with the same key', () => {
  test('returns the original transfer and moves no money the second time', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);

    const first = await transfer(a.token, body(a, b, 250), KEY);
    const retry = await transfer(a.token, body(a, b, 250), KEY);

    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.transaction).toEqual(first.body.transaction);
    expect(await balanceOf(a.account.id)).toBe(750);
    expect(await balanceOf(b.account.id)).toBe(250);
    expect(await ledger()).toHaveLength(1);
  });

  test('refuses the same key for a different amount', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);
    await transfer(a.token, body(a, b, 250), KEY);
    const res = await transfer(a.token, body(a, b, 300), KEY);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(a.account.id)).toBe(750);
  });

  test('refuses the same key for a different destination', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);
    const c = await party(3, 0);
    await transfer(a.token, body(a, b, 250), KEY);
    const res = await transfer(a.token, body(a, c, 250), KEY);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(b.account.id)).toBe(250);
    expect(await balanceOf(c.account.id)).toBe(0);
  });

  test('still succeeds after the destination was frozen', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);
    await transfer(a.token, body(a, b, 250), KEY);
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [b.account.id]);

    const retry = await transfer(a.token, body(a, b, 250), KEY);
    const fresh = await transfer(a.token, body(a, b, 250));

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(fresh.status).toBe(404);
    expect(await balanceOf(a.account.id)).toBe(750);
  });
});

describe('concurrency: many transfers at the same moment', () => {
  test('10 simultaneous transfers of 30 from a balance of 100: exactly 3 succeed', async () => {
    const a = await party(1, 100);
    const b = await party(2, 0);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => transfer(a.token, body(a, b, 30)))
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    const refused = responses.filter((r) => r.status === 422);
    expect(refused).toHaveLength(7);
    expect(refused.every((r) => r.body.error.code === 'INSUFFICIENT_FUNDS')).toBe(true);

    expect(await balanceOf(a.account.id)).toBe(10);
    expect(await balanceOf(b.account.id)).toBe(90);
    expect(await ledger()).toHaveLength(3);
  });

  test('opposite directions at once never deadlock: 20 A to B and 20 B to A', async () => {
    const a = await party(1, 10000);
    const b = await party(2, 10000);

    const requests = [];
    for (let i = 0; i < 20; i += 1) {
      requests.push(transfer(a.token, body(a, b, 100)));
      requests.push(transfer(b.token, body(b, a, 100)));
    }
    const responses = await Promise.all(requests);

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(a.account.id)).toBe(10000);
    expect(await balanceOf(b.account.id)).toBe(10000);
    expect(await ledger()).toHaveLength(40);
  }, 30000);

  test('a ring of three accounts at once never deadlocks: A to B, B to C, C to A', async () => {
    const a = await party(1, 10000);
    const b = await party(2, 10000);
    const c = await party(3, 10000);

    const requests = [];
    for (let i = 0; i < 10; i += 1) {
      requests.push(transfer(a.token, body(a, b, 100)));
      requests.push(transfer(b.token, body(b, c, 100)));
      requests.push(transfer(c.token, body(c, a, 100)));
    }
    const responses = await Promise.all(requests);

    expect(responses.every((r) => r.status === 201)).toBe(true);
    for (const p of [a, b, c]) {
      expect(await balanceOf(p.account.id)).toBe(10000);
    }
    expect(await ledger()).toHaveLength(30);
  }, 30000);

  test('a random storm of 60 transfers between 4 accounts: no money created or lost', async () => {
    const START = 10000;
    const parties = await Promise.all([1, 2, 3, 4].map((n) => party(n, START)));

    // A small fixed-seed random generator, so the storm is the same every run.
    let seed = 20240607;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const requests = [];
    for (let i = 0; i < 60; i += 1) {
      const from = parties[Math.floor(random() * 4)];
      let to = parties[Math.floor(random() * 4)];
      while (to === from) to = parties[Math.floor(random() * 4)];
      const amount = 1 + Math.floor(random() * 4000);
      requests.push(transfer(from.token, body(from, to, amount)));
    }
    const responses = await Promise.all(requests);

    expect(responses.every((r) => r.status === 201 || r.status === 422)).toBe(true);

    const rows = await ledger();
    expect(rows).toHaveLength(responses.filter((r) => r.status === 201).length);

    let total = 0;
    for (const p of parties) {
      const inbound = rows
        .filter((r) => r.to_account_id === p.account.id)
        .reduce((n, r) => n + Number(r.amount), 0);
      const outbound = rows
        .filter((r) => r.from_account_id === p.account.id)
        .reduce((n, r) => n + Number(r.amount), 0);
      const balance = await balanceOf(p.account.id);

      expect(balance).toBe(START + inbound - outbound);
      expect(balance).toBeGreaterThanOrEqual(0);
      total += balance;
    }
    expect(total).toBe(START * 4);
  }, 30000);

  test('10 simultaneous transfers with ONE key move the money exactly once', async () => {
    const a = await party(1, 1000);
    const b = await party(2, 0);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => transfer(a.token, body(a, b, 250), KEY))
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.transaction.id)).size).toBe(1);
    expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
    expect(await balanceOf(a.account.id)).toBe(750);
    expect(await balanceOf(b.account.id)).toBe(250);
    expect(await ledger()).toHaveLength(1);
  });
});
