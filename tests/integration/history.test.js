const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createAccount } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/auth');
const { insertTransaction, at } = require('../helpers/ledger');

const get = (token, query = '') =>
  request(app).get(`/api/v1/transactions${query}`).set('Authorization', `Bearer ${token}`);

const getForAccount = (token, accountId, query = '') =>
  request(app)
    .get(`/api/v1/accounts/${accountId}/transactions${query}`)
    .set('Authorization', `Bearer ${token}`);

let keyCounter = 0;
const post = (token, path, body) =>
  request(app)
    .post(`/api/v1/transactions/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', `history-key-${(keyCounter += 1)}`)
    .send(body);

// One person with one account. The 12-digit account number is 100000000000 plus n.
async function party(n, balance = 0) {
  const { token, user } = await registerAndLogin(`user${n}@x.com`);
  const number = String(100000000000 + n);
  const account = await createAccount(user.id, number, balance);
  return { token, user, account, number };
}

// Ids with a fixed, readable order: ...0001 < ...0002 < ...
const txId = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Walks every page and returns all the items in the order received.
async function walk(token, query = '', pathFn = get) {
  const pages = [];
  let cursor = null;
  do {
    const sep = query ? '&' : '?';
    const res = await pathFn(token, `${query}${cursor ? `${sep}cursor=${cursor}` : ''}`);
    expect(res.status).toBe(200);
    pages.push(res.body);
    cursor = res.body.pagination.nextCursor;
  } while (cursor);
  return pages;
}

const ids = (items) => items.map((item) => item.id);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await pool.end();
});

describe('authentication', () => {
  test('GET /transactions needs a token', async () => {
    const res = await request(app).get('/api/v1/transactions');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('GET /accounts/:id/transactions needs a token', async () => {
    const res = await request(app).get(
      '/api/v1/accounts/11111111-1111-4111-8111-111111111111/transactions'
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  test('a bad token is refused before any validation or query runs', async () => {
    const res = await request(app)
      .get('/api/v1/transactions?limit=zzz')
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });
});

describe('an empty history', () => {
  test('a user with no accounts gets an empty list, not an error', async () => {
    const { token } = await registerAndLogin('nobody@x.com');
    const res = await get(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      transactions: [],
      pagination: { limit: 20, hasMore: false, nextCursor: null },
    });
  });

  test('a user with an account but no activity gets an empty list', async () => {
    const a = await party(1);
    const res = await get(a.token);

    expect(res.body.transactions).toEqual([]);
    expect(res.body.pagination.hasMore).toBe(false);
  });
});

describe('what shows up', () => {
  test('deposits, withdrawals and transfers made through the API appear, newest first', async () => {
    const a = await party(1);
    const b = await party(2);

    await post(a.token, 'deposit', {
      accountId: a.account.id,
      amount: 5000,
      description: 'salary',
    });
    await post(a.token, 'withdraw', { accountId: a.account.id, amount: 700 });
    await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.number,
      amount: 1200,
      description: 'rent',
    });

    const res = await get(a.token);
    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t) => [t.type, t.direction, t.amount])).toEqual([
      ['transfer', 'debit', 1200],
      ['withdrawal', 'debit', 700],
      ['deposit', 'credit', 5000],
    ]);
    expect(res.body.transactions[0].description).toBe('rent');
  });

  test('a transfer appears for BOTH sides, as a debit for one and a credit for the other', async () => {
    const a = await party(1, 1000);
    const b = await party(2);
    const sent = await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.number,
      amount: 300,
    });
    const transferId = sent.body.transaction.id;

    const senderView = (await get(a.token)).body.transactions;
    const receiverView = (await get(b.token)).body.transactions;

    expect(senderView).toHaveLength(1);
    expect(receiverView).toHaveLength(1);
    expect(senderView[0]).toMatchObject({ id: transferId, direction: 'debit', amount: 300 });
    expect(receiverView[0]).toMatchObject({ id: transferId, direction: 'credit', amount: 300 });
  });

  test('every item has exactly the documented fields', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id, description: 'hello' });
    const [item] = (await get(a.token)).body.transactions;

    expect(Object.keys(item).sort()).toEqual(
      [
        'amount',
        'counterpartyAccountNumber',
        'createdAt',
        'description',
        'direction',
        'fromAccountId',
        'id',
        'status',
        'toAccountId',
        'type',
      ].sort()
    );
  });

  test('amounts are numbers of paise, and createdAt is an ISO timestamp', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id, amount: 1050, createdAt: at(1) });
    const [item] = (await get(a.token)).body.transactions;

    expect(item.amount).toBe(1050);
    expect(item.createdAt).toBe('2026-10-01T00:00:01.000Z');
  });

  test('history of a frozen or closed account can still be read', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });
    await pool.query(`UPDATE accounts SET status = 'frozen' WHERE id = $1`, [a.account.id]);
    expect((await get(a.token)).body.transactions).toHaveLength(1);

    await pool.query(`UPDATE accounts SET status = 'closed' WHERE id = $1`, [a.account.id]);
    expect((await get(a.token)).body.transactions).toHaveLength(1);
    expect((await getForAccount(a.token, a.account.id)).body.transactions).toHaveLength(1);
  });

  test("history covers all of a user's accounts together", async () => {
    const a = await party(1);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await insertTransaction({ to: a.account.id, amount: 1, createdAt: at(1) });
    await insertTransaction({ to: second.id, amount: 2, createdAt: at(2) });

    const res = await get(a.token);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([2, 1]);
  });
});

describe('scoping: a user sees only their own money', () => {
  test('rows that touch only other people never appear', async () => {
    const a = await party(1);
    const c = await party(3);
    const d = await party(4);
    await insertTransaction({ to: a.account.id, amount: 111, createdAt: at(1) });
    await insertTransaction({ to: c.account.id, amount: 222, createdAt: at(2) });
    await insertTransaction({
      from: c.account.id,
      to: d.account.id,
      type: 'transfer',
      amount: 333,
      createdAt: at(3),
    });
    await insertTransaction({
      from: d.account.id,
      type: 'withdrawal',
      amount: 444,
      createdAt: at(4),
    });

    const res = await get(a.token);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([111]);

    const cView = await get(c.token);
    expect(cView.body.transactions.map((t) => t.amount)).toEqual([333, 222]);
  });

  test('a transfer between two OTHER people is invisible even when both are known to the caller', async () => {
    const a = await party(1);
    const c = await party(3);
    const d = await party(4);
    await insertTransaction({ from: c.account.id, to: d.account.id, type: 'transfer' });

    expect((await get(a.token)).body.transactions).toEqual([]);
  });

  test("the other side's account id and full number never appear in a statement", async () => {
    const a = await party(1, 1000);
    const b = await party(2);
    await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.number,
      amount: 300,
    });

    const sender = await get(a.token);
    const receiver = await get(b.token);

    expect(sender.body.transactions[0].toAccountId).toBeNull();
    expect(sender.body.transactions[0].counterpartyAccountNumber).toBe('XXXXXXXX0002');
    expect(JSON.stringify(sender.body)).not.toContain(b.account.id);
    expect(JSON.stringify(sender.body)).not.toContain(b.number);

    expect(receiver.body.transactions[0].fromAccountId).toBeNull();
    expect(receiver.body.transactions[0].counterpartyAccountNumber).toBe('XXXXXXXX0001');
    expect(JSON.stringify(receiver.body)).not.toContain(a.account.id);
    expect(JSON.stringify(receiver.body)).not.toContain(a.number);
  });

  test('your own account ids ARE shown, because they are yours', async () => {
    const a = await party(1, 1000);
    const b = await party(2);
    await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: b.number,
      amount: 300,
    });
    const [item] = (await get(a.token)).body.transactions;
    expect(item.fromAccountId).toBe(a.account.id);
  });

  test('a transfer between your own two accounts is internal, and ONE row, not two', async () => {
    const a = await party(1, 1000);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: '100000000099',
      amount: 400,
    });

    const res = await get(a.token);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({
      direction: 'internal',
      fromAccountId: a.account.id,
      toAccountId: second.id,
      counterpartyAccountNumber: null,
    });
  });

  test('seen from one of the accounts, that internal transfer is a debit or a credit', async () => {
    const a = await party(1, 1000);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await post(a.token, 'transfer', {
      fromAccountId: a.account.id,
      toAccountNumber: '100000000099',
      amount: 400,
    });

    const fromSide = await getForAccount(a.token, a.account.id);
    const toSide = await getForAccount(a.token, second.id);
    expect(fromSide.body.transactions[0].direction).toBe('debit');
    expect(fromSide.body.transactions[0].counterpartyAccountNumber).toBe('XXXXXXXX0099');
    expect(toSide.body.transactions[0].direction).toBe('credit');
    expect(toSide.body.transactions[0].counterpartyAccountNumber).toBe('XXXXXXXX0001');
  });

  test("a forged cursor cannot be used to reach other people's rows", async () => {
    const a = await party(1);
    const c = await party(3);
    await insertTransaction({ to: a.account.id, amount: 1, createdAt: at(1) });
    await insertTransaction({ to: c.account.id, amount: 999, createdAt: at(2) });

    const forged = Buffer.from(
      JSON.stringify({
        t: '9999-12-31T23:59:59.999999Z',
        i: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      })
    ).toString('base64url');
    const res = await get(a.token, `?cursor=${forged}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([1]);
  });
});

describe('account filter and the per-account route', () => {
  test("GET /transactions?accountId= shows only that account's rows", async () => {
    const a = await party(1);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await insertTransaction({ to: a.account.id, amount: 1, createdAt: at(1) });
    await insertTransaction({ to: second.id, amount: 2, createdAt: at(2) });

    const res = await get(a.token, `?accountId=${second.id}`);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([2]);
  });

  test('GET /accounts/:id/transactions gives the same answer as the filter', async () => {
    const a = await party(1);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await insertTransaction({ to: a.account.id, amount: 1, createdAt: at(1) });
    await insertTransaction({ to: second.id, amount: 2, createdAt: at(2) });

    const viaFilter = await get(a.token, `?accountId=${second.id}`);
    const viaPath = await getForAccount(a.token, second.id);
    expect(viaPath.status).toBe(200);
    expect(viaPath.body).toEqual(viaFilter.body);
  });

  test('the per-account route supports the same filters and paging', async () => {
    const a = await party(1);
    for (let n = 1; n <= 5; n += 1) {
      await insertTransaction({ to: a.account.id, amount: n, createdAt: at(n) });
    }
    const res = await getForAccount(a.token, a.account.id, '?limit=2&type=deposit');
    expect(res.body.transactions.map((t) => t.amount)).toEqual([5, 4]);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  test('an account id in capital letters works for your own account', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });
    const res = await getForAccount(a.token, a.account.id.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
  });
});

describe("IDOR: someone else's account is indistinguishable from a missing one", () => {
  const MISSING = '12345678-1234-4234-8234-123456789012';

  test("filtering by another user's account is the same 404 as an account that does not exist", async () => {
    const a = await party(1);
    const c = await party(3);
    await insertTransaction({ to: c.account.id });

    const foreign = await get(a.token, `?accountId=${c.account.id}`);
    const missing = await get(a.token, `?accountId=${MISSING}`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(foreign.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('the per-account route gives the same 404 for foreign and missing accounts', async () => {
    const a = await party(1);
    const c = await party(3);
    await insertTransaction({ to: c.account.id });

    const foreign = await getForAccount(a.token, c.account.id);
    const missing = await getForAccount(a.token, MISSING);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  test('a foreign account id with capital letters is refused the same way', async () => {
    const a = await party(1);
    const c = await party(3);
    const res = await getForAccount(a.token, c.account.id.toUpperCase());
    expect(res.status).toBe(404);
  });

  test("a token for one user cannot read another user's per-account history", async () => {
    const a = await party(1);
    const c = await party(3);
    await insertTransaction({ to: c.account.id, amount: 777 });

    const res = await getForAccount(a.token, c.account.id);
    expect(JSON.stringify(res.body)).not.toContain('777');
  });
});

describe('ordering', () => {
  test('newest first', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id, amount: 1, createdAt: at(1) });
    await insertTransaction({ to: a.account.id, amount: 3, createdAt: at(3) });
    await insertTransaction({ to: a.account.id, amount: 2, createdAt: at(2) });

    const res = await get(a.token);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([3, 2, 1]);
  });

  test('rows with the SAME timestamp come out in a fixed order: higher id first', async () => {
    const a = await party(1);
    for (const n of [2, 5, 1, 4, 3]) {
      await insertTransaction({ id: txId(n), to: a.account.id, createdAt: at(1) });
    }

    const first = ids((await get(a.token)).body.transactions);
    const second = ids((await get(a.token)).body.transactions);
    expect(first).toEqual([5, 4, 3, 2, 1].map(txId));
    expect(second).toEqual(first);
  });

  test('timestamps that differ only in microseconds are ordered correctly', async () => {
    const a = await party(1);
    await insertTransaction({ id: txId(1), to: a.account.id, createdAt: at(1, 100) });
    await insertTransaction({ id: txId(2), to: a.account.id, createdAt: at(1, 300) });
    await insertTransaction({ id: txId(3), to: a.account.id, createdAt: at(1, 200) });

    const res = await get(a.token);
    expect(ids(res.body.transactions)).toEqual([txId(2), txId(3), txId(1)]);
  });
});

describe('pagination', () => {
  async function seed(account, count) {
    const created = [];
    for (let n = 1; n <= count; n += 1) {
      created.push(
        await insertTransaction({ id: txId(n), to: account.id, amount: n, createdAt: at(n) })
      );
    }
    return created.reverse(); // newest first, the order the API must return
  }

  test('defaults to 20 per page', async () => {
    const a = await party(1);
    await seed(a.account, 25);
    const res = await get(a.token);

    expect(res.body.transactions).toHaveLength(20);
    expect(res.body.pagination).toMatchObject({ limit: 20, hasMore: true });
    expect(typeof res.body.pagination.nextCursor).toBe('string');
  });

  test('walking every page returns every row exactly once, in order', async () => {
    const a = await party(1);
    const expected = await seed(a.account, 25);

    const pages = await walk(a.token, '?limit=10');
    expect(pages.map((p) => p.transactions.length)).toEqual([10, 10, 5]);
    expect(pages.map((p) => p.pagination.hasMore)).toEqual([true, true, false]);
    expect(pages[2].pagination.nextCursor).toBeNull();

    const all = pages.flatMap((p) => ids(p.transactions));
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(25);
  });

  test('exactly one full page means no next page', async () => {
    const a = await party(1);
    await seed(a.account, 10);
    const res = await get(a.token, '?limit=10');

    expect(res.body.transactions).toHaveLength(10);
    expect(res.body.pagination).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });

  test('limit=1 walks the whole history one row at a time', async () => {
    const a = await party(1);
    const expected = await seed(a.account, 7);
    const pages = await walk(a.token, '?limit=1');
    expect(pages.flatMap((p) => ids(p.transactions))).toEqual(expected);
  });

  test('rows with identical timestamps that span a page boundary are neither skipped nor repeated', async () => {
    const a = await party(1);
    const expected = [];
    for (let n = 7; n >= 1; n -= 1) {
      expected.push(await insertTransaction({ id: txId(n), to: a.account.id, createdAt: at(1) }));
    }

    const pages = await walk(a.token, '?limit=3');
    expect(pages.flatMap((p) => ids(p.transactions))).toEqual(expected);
  });

  test('rows that differ only in microseconds are not lost at a page boundary', async () => {
    const a = await party(1);
    const expected = [];
    for (let n = 6; n >= 1; n -= 1) {
      // Same millisecond, six different microseconds. A JavaScript Date cannot tell them apart.
      expected.push(
        await insertTransaction({ id: txId(n), to: a.account.id, createdAt: at(1, n) })
      );
    }

    const pages = await walk(a.token, '?limit=2');
    expect(pages.flatMap((p) => ids(p.transactions))).toEqual(expected);
  });

  test('a row added at the top between two requests does not shift the next page', async () => {
    const a = await party(1);
    await seed(a.account, 6);

    const page1 = await get(a.token, '?limit=2');
    expect(page1.body.transactions.map((t) => t.amount)).toEqual([6, 5]);

    await insertTransaction({ id: txId(99), to: a.account.id, amount: 99, createdAt: at(50) });

    const page2 = await get(a.token, `?limit=2&cursor=${page1.body.pagination.nextCursor}`);
    expect(page2.body.transactions.map((t) => t.amount)).toEqual([4, 3]);
  });

  test('works across pages when the history mixes both sides of transfers', async () => {
    const a = await party(1, 100000);
    const b = await party(2, 100000);
    for (let n = 0; n < 4; n += 1) {
      await post(a.token, 'transfer', {
        fromAccountId: a.account.id,
        toAccountNumber: b.number,
        amount: 10 + n,
      });
      await post(b.token, 'transfer', {
        fromAccountId: b.account.id,
        toAccountNumber: a.number,
        amount: 20 + n,
      });
    }

    const pages = await walk(a.token, '?limit=3');
    const all = pages.flatMap((p) => p.transactions);
    expect(all).toHaveLength(8);
    expect(new Set(ids(all)).size).toBe(8);
    expect(all.filter((t) => t.direction === 'debit')).toHaveLength(4);
    expect(all.filter((t) => t.direction === 'credit')).toHaveLength(4);
  });

  test('the maximum page size of 100 works, and 101 is refused', async () => {
    const a = await party(1);
    expect((await get(a.token, '?limit=100')).status).toBe(200);
    const res = await get(a.token, '?limit=101');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('limit');
  });

  test('the cursor stays valid when the filters are the same on the next request', async () => {
    const a = await party(1);
    for (let n = 1; n <= 6; n += 1) {
      await insertTransaction({ to: a.account.id, amount: n, createdAt: at(n), type: 'deposit' });
      await insertTransaction({
        from: a.account.id,
        type: 'withdrawal',
        amount: 100 + n,
        createdAt: at(n, 500),
      });
    }

    const pages = await walk(a.token, '?type=deposit&limit=4');
    const all = pages.flatMap((p) => p.transactions);
    expect(all.map((t) => t.amount)).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

describe('filters', () => {
  async function mixed(a) {
    await insertTransaction({ to: a.account.id, type: 'deposit', amount: 1, createdAt: at(10) });
    await insertTransaction({
      from: a.account.id,
      type: 'withdrawal',
      amount: 2,
      createdAt: at(20),
    });
    await insertTransaction({ to: a.account.id, type: 'deposit', amount: 3, createdAt: at(30) });
  }

  test.each([
    ['deposit', [3, 1]],
    ['withdrawal', [2]],
    ['transfer', []],
  ])('type=%s', async (type, amounts) => {
    const a = await party(1);
    await mixed(a);
    const res = await get(a.token, `?type=${type}`);
    expect(res.body.transactions.map((t) => t.amount)).toEqual(amounts);
  });

  test('from INCLUDES a row at exactly that moment', async () => {
    const a = await party(1);
    await mixed(a);
    const res = await get(a.token, `?from=${encodeURIComponent('2026-10-01T00:00:20Z')}`);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([3, 2]);
  });

  test('to EXCLUDES a row at exactly that moment', async () => {
    const a = await party(1);
    await mixed(a);
    const res = await get(a.token, `?to=${encodeURIComponent('2026-10-01T00:00:20Z')}`);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([1]);
  });

  test('back-to-back ranges cover every row once: nothing missed, nothing doubled', async () => {
    const a = await party(1);
    await mixed(a);
    const t = (s) => encodeURIComponent(`2026-10-01T00:00:${s}Z`);
    const first = await get(a.token, `?from=${t('00')}&to=${t('20')}`);
    const second = await get(a.token, `?from=${t('20')}&to=${t('59')}`);
    const amounts = [...second.body.transactions, ...first.body.transactions].map((x) => x.amount);
    expect(amounts).toEqual([3, 2, 1]);
  });

  test('a time zone offset means the same moment, not the same clock time', async () => {
    const a = await party(1);
    await mixed(a); // the middle row is at 00:00:20 UTC
    // 05:30:20 at +05:30 is exactly 00:00:20 UTC
    const res = await get(a.token, `?from=${encodeURIComponent('2026-10-01T05:30:20+05:30')}`);
    expect(res.body.transactions.map((t) => t.amount)).toEqual([3, 2]);
  });

  test('filters combine: type, range and account together', async () => {
    const a = await party(1);
    const second = await createAccount(a.user.id, '100000000099', 0);
    await mixed(a);
    await insertTransaction({ to: second.id, type: 'deposit', amount: 9, createdAt: at(30) });

    const res = await get(
      a.token,
      `?type=deposit&accountId=${a.account.id}&from=${encodeURIComponent('2026-10-01T00:00:15Z')}`
    );
    expect(res.body.transactions.map((t) => t.amount)).toEqual([3]);
  });

  test('a filter that matches nothing is an empty list, not an error', async () => {
    const a = await party(1);
    await mixed(a);
    const res = await get(a.token, `?from=${encodeURIComponent('2030-01-01T00:00:00Z')}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
  });

  test('unknown parameters are ignored, and userId cannot be smuggled in', async () => {
    const a = await party(1);
    const c = await party(3);
    await insertTransaction({ to: c.account.id, amount: 555 });
    const res = await get(a.token, `?userId=${c.user.id}&owner=${c.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
  });
});

describe('bad parameters are a clean 400, never a 500', () => {
  const badQueries = [
    ['limit=0', 'limit'],
    ['limit=-1', 'limit'],
    ['limit=1.5', 'limit'],
    ['limit=abc', 'limit'],
    ['limit=', 'limit'],
    ['limit=101', 'limit'],
    ['limit=1&limit=2', 'limit'],
    ['type=withdraw', 'type'],
    ['type=', 'type'],
    ['type=deposit&type=transfer', 'type'],
    ['from=yesterday', 'from'],
    ['from=2026-10-01', 'from'],
    ['from=2026-10-01T00:00:00', 'from'],
    ['from=2026-02-30T00:00:00Z', 'from'],
    ['from=0000-01-01T00:00:00Z', 'from'],
    ['to=2026-13-01T00:00:00Z', 'to'],
    ['from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z', 'from'],
    ['accountId=not-a-uuid', 'accountId'],
    ['accountId=', 'accountId'],
    ['cursor=garbage', 'cursor'],
    ['cursor=', 'cursor'],
    [`cursor=${'a'.repeat(400)}`, 'cursor'],
  ];

  for (const [query, field] of badQueries) {
    test(`?${query.slice(0, 50)}`, async () => {
      const a = await party(1);
      const res = await get(a.token, `?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.field)).toContain(field);
    });
  }

  test('an id that is not a UUID in the path is a 400 on the per-account route', async () => {
    const a = await party(1);
    const res = await getForAccount(a.token, 'nope');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('id');
  });

  test('a cursor with a timestamp that is not a real date is refused, not sent to PostgreSQL', async () => {
    const a = await party(1);
    const bad = Buffer.from(
      JSON.stringify({ t: '2026-02-30T00:00:00.000000Z', i: txId(1) })
    ).toString('base64url');
    const res = await get(a.token, `?cursor=${bad}`);
    expect(res.status).toBe(400);
  });

  test('a SQL injection attempt in a parameter is just an invalid value', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });
    const res = await get(a.token, `?type=${encodeURIComponent("deposit' OR '1'='1")}`);
    expect(res.status).toBe(400);
    expect((await pool.query('SELECT count(*) FROM transactions')).rows[0].count).toBe('1');
  });
});

describe('the query uses the indexes', () => {
  // Captures the exact SQL and parameters of a real request, then asks PostgreSQL how it would
  // run it. With sequential scans switched off, a plan that still avoids the indexes means
  // the indexes are missing or unusable. LOCAL keeps the setting inside this transaction.
  async function planFor(token, query, beforePlan = async () => {}) {
    const spy = jest.spyOn(pool, 'query');
    await get(token, query);
    const call = spy.mock.calls.find(([text]) => /FROM transactions/.test(text));
    spy.mockRestore();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      await beforePlan(client);
      const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${call[0]}`, call[1]);
      return JSON.stringify(rows[0]['QUERY PLAN']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  test('both account columns are searched through their indexes, with no sequential scan', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });

    const plan = await planFor(a.token, '?limit=5');
    expect(plan).toContain('transactions_from_idx');
    expect(plan).toContain('transactions_to_idx');
    expect(plan).not.toContain('Seq Scan');
  });

  test('the same holds for a filtered, cursor-paged request', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });
    await insertTransaction({ to: a.account.id, createdAt: at(5) });
    const cursor = (await get(a.token, '?limit=1&type=deposit')).body.pagination.nextCursor;

    const plan = await planFor(
      a.token,
      `?limit=1&type=deposit&from=${encodeURIComponent('2020-01-01T00:00:00Z')}&cursor=${cursor}`
    );
    expect(plan).toContain('transactions_to_idx');
    expect(plan).not.toContain('Seq Scan');
  });

  test('this check can fail: without the indexes the plan is a sequential scan', async () => {
    const a = await party(1);
    await insertTransaction({ to: a.account.id });

    const plan = await planFor(a.token, '?limit=5', async (client) => {
      await client.query('DROP INDEX transactions_from_idx');
      await client.query('DROP INDEX transactions_to_idx');
    });
    expect(plan).toContain('Seq Scan');
  });
});
