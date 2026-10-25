const request = require('supertest');
const app = require('../../src/app');
const { pool, resetDb, createUser, createAccount } = require('../helpers/db');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');
const repository = require('../../src/modules/monitoring/monitoring.repository');
const monitoring = require('../../src/modules/monitoring/monitoring.service');
const transactions = require('../../src/modules/transactions/transactions.repository');

let user;
let token;
let source;
let destination;
let key = 0;
const LARGE = 10000000;
const post = (type, body, idempotencyKey = `monitoring-key-${++key}`) =>
  request(app)
    .post(`/api/v1/transactions/${type}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
const transfer = (amount = 100, idempotencyKey) =>
  post(
    'transfer',
    {
      fromAccountId: source.id,
      toAccountNumber: destination.account_number,
      amount,
    },
    idempotencyKey
  );
const alerts = async () => (await pool.query('SELECT * FROM monitoring_alerts')).rows;

beforeEach(async () => {
  await resetDb();
  user = await createUser('source@x.com');
  token = signAccessToken({ id: user.id, role: 'user' });
  source = await createAccount(user.id, '123456789012', LARGE * 10);
  const other = await createUser('destination@x.com');
  destination = await createAccount(other.id, '123456789013', 0);
});
afterAll(async () => {
  await resetDb();
  await pool.end();
});

test.each(['deposit', 'withdraw', 'transfer'])(
  'a large %s commits money, ledger and alert together',
  async (type) => {
    const body =
      type === 'transfer'
        ? { fromAccountId: source.id, toAccountNumber: destination.account_number, amount: LARGE }
        : { accountId: source.id, amount: LARGE };
    const res = await post(type, body);
    expect(res.status).toBe(201);
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transaction_id: res.body.transaction.id,
      account_id: source.id,
      rule_code: 'LARGE_TRANSACTION',
      severity: 'medium',
      details: { amount: LARGE, thresholdPaise: LARGE, ruleVersion: 1 },
    });
    expect(
      Number(
        (await pool.query('SELECT balance FROM accounts WHERE id=$1', [source.id])).rows[0].balance
      )
    ).toBe(LARGE * (type === 'deposit' ? 11 : 9));
  }
);
test('one paisa below the large amount threshold produces no alert', async () => {
  expect((await post('deposit', { accountId: source.id, amount: LARGE - 1 })).status).toBe(201);
  expect(await alerts()).toEqual([]);
});
test('the fifth and sixth outgoing transfers generate separate velocity alerts', async () => {
  for (let n = 1; n <= 6; n++) {
    const res = await transfer();
    expect(res.status).toBe(201);
    expect(await alerts()).toHaveLength(Math.max(0, n - 4));
  }
  const rows = await alerts();
  expect(rows.every((row) => row.rule_code === 'RAPID_TRANSFERS')).toBe(true);
  expect(rows.every((row) => row.account_id === source.id)).toBe(true);
  expect(rows[0].details).toEqual({ countAtLeast: 5, windowSeconds: 300, ruleVersion: 1 });
});
test('a transaction can generate both alerts without changing the movement response', async () => {
  for (let i = 0; i < 4; i++) expect((await transfer()).status).toBe(201);
  const res = await transfer(LARGE);
  expect(res.status).toBe(201);
  expect(res.body).not.toHaveProperty('alerts');
  const rows = await alerts();
  expect(rows.map((row) => row.rule_code).sort()).toEqual(['LARGE_TRANSACTION', 'RAPID_TRANSFERS']);
  expect(rows.every((row) => row.transaction_id === res.body.transaction.id)).toBe(true);
});
test('same-key retries never repeat monitoring or count as extra transfers', async () => {
  const first = await transfer(100, 'velocity-replay-key');
  for (let i = 0; i < 8; i++) {
    const retry = await transfer(100, 'velocity-replay-key');
    expect(retry.status).toBe(201);
    expect(retry.body.transaction.id).toBe(first.body.transaction.id);
  }
  expect(await alerts()).toHaveLength(0);
  expect((await pool.query("SELECT * FROM transactions WHERE type='transfer'")).rows).toHaveLength(
    1
  );
});
test('concurrent same-key large movements create exactly one alert', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      post('deposit', { accountId: source.id, amount: LARGE }, 'same-large-key')
    )
  );
  expect(results.every((res) => res.status === 201)).toBe(true);
  expect(new Set(results.map((res) => res.body.transaction.id)).size).toBe(1);
  expect(await alerts()).toHaveLength(1);
  expect(
    Number(
      (await pool.query('SELECT balance FROM accounts WHERE id=$1', [source.id])).rows[0].balance
    )
  ).toBe(LARGE * 11);
});
test('a replay never adds a retroactive velocity alert to an older transaction', async () => {
  const first = await transfer(100, 'earlier-transfer-key');
  for (let i = 0; i < 4; i++) await transfer();
  const before = await alerts();
  expect(before).toHaveLength(1);
  const retry = await transfer(100, 'earlier-transfer-key');
  expect(retry.status).toBe(201);
  expect(retry.body.transaction.id).toBe(first.body.transaction.id);
  expect(await alerts()).toEqual(before);
});
test('ten concurrent distinct transfers cannot evade velocity and conserve money', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => transfer()));
  expect(results.every((res) => res.status === 201)).toBe(true);
  expect(await alerts()).toHaveLength(6);
  expect(new Set((await alerts()).map((row) => row.transaction_id)).size).toBe(6);
  const balances = (await pool.query('SELECT id, balance FROM accounts')).rows;
  expect(balances.reduce((sum, row) => sum + Number(row.balance), 0)).toBe(LARGE * 10);
  expect(Number(balances.find((row) => row.id === source.id).balance)).toBe(LARGE * 10 - 1000);
});
test('refused movements create neither ledger rows nor alerts', async () => {
  expect((await post('withdraw', { accountId: source.id, amount: LARGE * 20 })).status).toBe(422);
  expect((await post('withdraw', { accountId: destination.id, amount: LARGE })).status).toBe(404);
  expect((await post('deposit', { accountId: source.id, amount: -1 })).status).toBe(400);
  expect(await alerts()).toHaveLength(0);
  expect((await pool.query('SELECT * FROM transactions')).rows).toHaveLength(0);
});
test('alert insert failure rolls back the balance and ledger; retry may then succeed', async () => {
  const spy = jest
    .spyOn(repository, 'insert')
    .mockRejectedValueOnce(new Error('deliberate alert failure'));
  try {
    const res = await post(
      'deposit',
      { accountId: source.id, amount: LARGE },
      'rollback-large-key'
    );
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(await alerts()).toHaveLength(0);
    expect((await pool.query('SELECT * FROM transactions')).rows).toHaveLength(0);
    expect(
      Number(
        (await pool.query('SELECT balance FROM accounts WHERE id=$1', [source.id])).rows[0].balance
      )
    ).toBe(LARGE * 10);
  } finally {
    spy.mockRestore();
  }
  expect(
    (await post('deposit', { accountId: source.id, amount: LARGE }, 'rollback-large-key')).status
  ).toBe(201);
  expect(await alerts()).toHaveLength(1);
});
test('failure writing the SECOND alert rolls back the first alert and both account changes', async () => {
  for (let i = 0; i < 4; i++) await transfer();
  const before = (await pool.query('SELECT id, balance FROM accounts ORDER BY id')).rows;
  const original = repository.insert;
  const spy = jest
    .spyOn(repository, 'insert')
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error('deliberate second-alert failure'));
  try {
    expect((await transfer(LARGE)).status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await alerts()).toHaveLength(0);
    expect((await pool.query('SELECT * FROM transactions')).rows).toHaveLength(4);
    expect((await pool.query('SELECT id, balance FROM accounts ORDER BY id')).rows).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

async function seedTransfer({
  from = source.id,
  to = destination.id,
  type = 'transfer',
  status = 'completed',
  age = "INTERVAL '4 minutes'",
} = {}) {
  // age is fixed test SQL, never request input.
  const { rows } = await pool.query(
    `INSERT INTO transactions
    (type, from_account_id, to_account_id, amount, status, created_at)
    VALUES ($1, $2, $3, 100, $4, statement_timestamp() - ${age}) RETURNING id`,
    [type, from, to, status]
  );
  return rows[0].id;
}
test('velocity excludes old, future, failed/pending, incoming and withdrawal rows', async () => {
  for (let i = 0; i < 5; i++) {
    await seedTransfer({ age: "INTERVAL '6 minutes'" });
    await seedTransfer({ age: "INTERVAL '-1 minute'" });
    await seedTransfer({ status: 'failed' });
    await seedTransfer({ status: 'pending' });
    await seedTransfer({ from: destination.id, to: source.id });
    await seedTransfer({ type: 'withdrawal', to: null });
  }
  expect((await transfer()).status).toBe(201);
  expect(await alerts()).toHaveLength(0);
  for (let i = 0; i < 3; i++) await seedTransfer();
  expect((await transfer()).status).toBe(201);
  expect(await alerts()).toHaveLength(1);
});
test('monitoring does not use another connection to count recent transfers', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = await transactions.insert(client, {
      type: 'transfer',
      fromAccountId: source.id,
      toAccountId: destination.id,
      amount: 100,
      idempotencyKey: 'uncommitted-monitor',
    });
    for (let i = 0; i < 4; i++)
      await client.query(
        `INSERT INTO transactions
      (type, from_account_id, to_account_id, amount) VALUES ('transfer', $1, $2, 100)`,
        [source.id, destination.id]
      );
    await monitoring.record(client, tx);
    expect((await client.query('SELECT * FROM monitoring_alerts')).rows).toHaveLength(1);
    expect(await alerts()).toHaveLength(0); // other connection sees neither uncommitted alert nor rows
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
test('ledger timestamp marks insertion time, not the start of a transaction waiting on locks', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_sleep(0.02)');
    const tx = await transactions.insert(client, {
      type: 'deposit',
      fromAccountId: null,
      toAccountId: source.id,
      amount: 100,
      idempotencyKey: 'timestamp-test-key',
    });
    const { rows } = await client.query(
      'SELECT created_at > transaction_timestamp() AS after_begin FROM transactions WHERE id=$1',
      [tx.id]
    );
    expect(rows[0].after_begin).toBe(true);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
test('alert uniqueness is a database backstop; re-evaluation cannot overwrite evidence', async () => {
  const res = await post('deposit', { accountId: source.id, amount: LARGE });
  const before = await alerts();
  await repository.insert(pool, res.body.transaction, {
    ruleCode: 'LARGE_TRANSACTION',
    severity: 'high',
    details: { changed: true },
  });
  expect(await alerts()).toEqual(before);
  await expect(
    pool.query(
      `INSERT INTO monitoring_alerts (transaction_id, account_id, rule_code, severity, details)
    VALUES ($1, $2, 'LARGE_TRANSACTION', 'medium', '{}')`,
      [res.body.transaction.id, source.id]
    )
  ).rejects.toMatchObject({ code: '23505' });
});
test.each([
  ['rule_code', 'UNKNOWN'],
  ['severity', 'low'],
  ['details', '[]'],
])('database refuses invalid alert %s', async (column, value) => {
  await post('deposit', { accountId: source.id, amount: LARGE });
  await expect(
    pool.query(`UPDATE monitoring_alerts SET ${column} = $1`, [value])
  ).rejects.toMatchObject({ code: '23514' });
});
test('alert references must point at real transactions and accounts', async () => {
  await expect(
    pool.query(
      `INSERT INTO monitoring_alerts (transaction_id, account_id, rule_code, severity, details)
    VALUES ('11111111-1111-4111-8111-111111111111', $1, 'LARGE_TRANSACTION', 'medium', '{}')`,
      [source.id]
    )
  ).rejects.toMatchObject({ code: '23503' });
});
