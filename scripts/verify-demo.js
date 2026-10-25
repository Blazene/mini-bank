// Opt-in HTTP verification. No dotenv, DB connection, admin grant or data resets.
const { randomBytes } = require('node:crypto');
const { parseArgs: parseOptions } = require('node:util');

const HELP = `Usage: npm run verify:demo -- [--base-url http://localhost:3000] [--write] [--allow-remote-writes]
Default: read-only public health/docs/auth checks. Use the origin, without /api/v1.
--write creates two disposable users, accounts, fake money and one loan application.
Remote writes additionally require --allow-remote-writes. Rows remain in the demo DB.
Never use this tool against real customer data. Passwords and tokens are not printed.`;

function parseArgs(args) {
  let values;
  try {
    ({ values } = parseOptions({
      args,
      options: {
        'base-url': { type: 'string', default: 'http://localhost:3000' },
        write: { type: 'boolean', default: false },
        'allow-remote-writes': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch {
    throw new Error('Invalid arguments; use --help.');
  }
  if (values.help) return { help: true };
  let url;
  try {
    url = new URL(values['base-url']);
  } catch {
    throw new Error('Base URL must be an HTTP(S) origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (!local && url.protocol !== 'https:')
  ) {
    throw new Error(
      'Use an HTTP(S) origin without credentials, path or query; remote targets require HTTPS.'
    );
  }
  if (values.write && !local && !values['allow-remote-writes']) {
    throw new Error('Remote writes require both --write and --allow-remote-writes.');
  }
  return {
    base: url.origin,
    write: values.write,
    allowRemoteWrites: values['allow-remote-writes'],
  };
}

function check(condition, message) {
  // Never interpolate an HTTP body, Authorization header, URL input or credentials.
  if (!condition) throw new Error(message);
}

async function verify(options, { fetchImpl = fetch, log = console.log } = {}) {
  // Validate here too: callers must not bypass CLI safeguards by importing verify().
  const args = ['--base-url', options.base];
  if (options.write) args.push('--write');
  if (options.allowRemoteWrites) args.push('--allow-remote-writes');
  const config = parseArgs(args);
  async function request(method, route, { body, token, key, origin, text = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.base}/api/v1${route}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(`HTTP request failed: ${method} ${route} (network, redirect or timeout).`);
    }
    let data;
    try {
      data = text ? await response.text() : await response.json();
    } catch {
      throw new Error(`Unreadable response: ${method} ${route}.`);
    }
    return { status: response.status, headers: response.headers, data };
  }
  const health = await request('GET', '/health', { origin: 'https://unlisted.example' });
  check(
    health.status === 200 && health.data.status === 'ok' && health.data.database === 'up',
    'Health/database check failed.'
  );
  check(
    health.headers.get('access-control-allow-origin') === null,
    'Unlisted origin received CORS permission.'
  );
  check(
    health.headers.get('x-content-type-options') === 'nosniff',
    'Missing nosniff security header.'
  );
  check(health.headers.get('x-powered-by') === null, 'Framework header is exposed.');
  if (config.base.startsWith('https:'))
    check(!!health.headers.get('strict-transport-security'), 'Missing HSTS header.');
  const spec = await request('GET', '/openapi.json');
  check(
    spec.status === 200 &&
      spec.data.openapi === '3.0.3' &&
      spec.data.servers?.[0]?.url === '/api/v1',
    'OpenAPI/same-origin server check failed.'
  );
  const docs = await request('GET', '/docs/', { text: true });
  check(docs.status === 200 && docs.data.includes('swagger-ui'), 'Swagger HTML check failed.');
  const protectedRoute = await request('GET', '/accounts');
  check(
    protectedRoute.status === 401 && protectedRoute.data.error?.code === 'MISSING_TOKEN',
    'Unauthenticated accounts must be refused.'
  );
  const invalidToken = await request('GET', '/auth/me', { token: 'invalid-demo-token' });
  check(
    invalidToken.status === 401 && invalidToken.data.error?.code === 'INVALID_TOKEN',
    'Invalid bearer token must be refused.'
  );
  log(
    'PASS: health/database, security headers, closed CORS, same-origin OpenAPI and authentication guards.'
  );
  if (!config.write) return;

  log('Creating disposable demo rows; no existing rows will be reset or deleted.');
  const suffix = randomBytes(10).toString('hex');
  async function person(label, type) {
    const email = `demo-${label}-${suffix}@example.com`,
      password = randomBytes(24).toString('hex');
    const register = await request('POST', '/auth/register', {
      body: { email, password, fullName: 'Disposable Demo User' },
    });
    check(register.status === 201, 'Disposable registration failed (check registration limits).');
    const login = await request('POST', '/auth/login', { body: { email, password } });
    check(login.status === 200 && typeof login.data.token === 'string', 'Disposable login failed.');
    const token = login.data.token;
    const created = await request('POST', '/accounts', { token, body: { type } });
    check(
      created.status === 201 && !!created.data.account?.id,
      'Disposable account creation failed.'
    );
    return { token, account: created.data.account };
  }
  const owner = await person('owner', 'savings'),
    other = await person('other', 'current');
  const deposit = { accountId: owner.account.id, amount: 100000 };
  const key = `demo-deposit-${suffix}`;
  check(
    (await request('POST', '/transactions/deposit', { token: owner.token, body: deposit, key }))
      .status === 201,
    'Deposit failed.'
  );
  const replay = await request('POST', '/transactions/deposit', {
    token: owner.token,
    body: deposit,
    key,
  });
  check(
    replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true',
    'Deposit replay failed.'
  );
  const changed = await request('POST', '/transactions/deposit', {
    token: owner.token,
    body: { ...deposit, amount: 100001 },
    key,
  });
  check(changed.status === 422, 'Changed input reused an idempotency key.');
  check(
    (await request('GET', `/accounts/${owner.account.id}`, { token: other.token })).status === 404,
    'Account ownership isolation failed.'
  );
  const transfer = {
    fromAccountId: owner.account.id,
    toAccountNumber: other.account.accountNumber,
    amount: 25000,
  };
  const transferKey = `demo-transfer-${suffix}`;
  check(
    (
      await request('POST', '/transactions/transfer', {
        token: owner.token,
        body: transfer,
        key: transferKey,
      })
    ).status === 201,
    'Transfer failed.'
  );
  const transferReplay = await request('POST', '/transactions/transfer', {
    token: owner.token,
    body: transfer,
    key: transferKey,
  });
  check(
    transferReplay.status === 201 && transferReplay.headers.get('idempotent-replayed') === 'true',
    'Transfer replay failed.'
  );
  check(
    (
      await request('POST', '/transactions/withdraw', {
        token: owner.token,
        body: { accountId: owner.account.id, amount: 10000 },
        key: `demo-withdraw-${suffix}`,
      })
    ).status === 201,
    'Withdrawal failed.'
  );
  const a = await request('GET', `/accounts/${owner.account.id}`, { token: owner.token });
  const b = await request('GET', `/accounts/${other.account.id}`, { token: other.token });
  check(
    a.status === 200 &&
      b.status === 200 &&
      a.data.account?.balance === 65000 &&
      b.data.account?.balance === 25000,
    'Final balances are incorrect.'
  );
  const history = await request('GET', `/accounts/${owner.account.id}/transactions`, {
    token: owner.token,
  });
  check(
    history.status === 200 && history.data.transactions?.length === 3,
    'Expected exactly three ledger rows (no replay duplicates).'
  );
  log(
    'PASS: registration/login, ownership, deposit/transfer replay, changed-key refusal, withdrawal and ledger/balances.'
  );
  const terms = { principal: 10000000, tenureMonths: 12, monthlyIncome: 5000000 };
  const quote = await request('POST', '/loans/quote', { token: owner.token, body: terms });
  check(
    quote.status === 200 && quote.data.quote?.emi === 888488,
    'Loan quote differs from the documented EMI.'
  );
  const applicationKey = `demo-application-${suffix}`;
  const application = await request('POST', '/loans/applications', {
    token: owner.token,
    body: terms,
    key: applicationKey,
  });
  check(
    application.status === 201 && application.data.application?.status === 'pending',
    'Loan application failed.'
  );
  const applicationReplay = await request('POST', '/loans/applications', {
    token: owner.token,
    body: terms,
    key: applicationKey,
  });
  check(
    applicationReplay.status === 201 &&
      applicationReplay.data.application?.id === application.data.application.id &&
      applicationReplay.headers.get('idempotent-replayed') === 'true',
    'Loan application replay failed.'
  );
  check(
    (
      await request('GET', `/loans/applications/${application.data.application.id}`, {
        token: other.token,
      })
    ).status === 404,
    'Loan ownership isolation failed.'
  );
  check(
    (await request('GET', '/admin/alerts', { token: owner.token })).status === 403,
    'Customer must not access admin alerts.'
  );
  log('PASS: quote EMI 888488 paise, pending application/replay, loan ownership and admin denial.');
  log('Demo complete. Disposable rows remain; credentials stayed in memory and were not printed.');
}

async function main(args, { log = console.log, error = console.error, ...dependencies } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      log(HELP);
      return 0;
    }
    await verify(options, { log, ...dependencies });
    return 0;
  } catch (err) {
    error(`FAIL: ${err.message}`);
    return 1;
  }
}

if (require.main === module)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
module.exports = { parseArgs, verify, main };
