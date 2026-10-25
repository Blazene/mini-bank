const { ACTION_NAMES } = require('../audit/audit.actions');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items) => ({ type: 'array', items });
const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const nullableUuid = { ...uuid, nullable: true };
const nullableText = { type: 'string', nullable: true };
const money = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  description: 'Whole paise, not rupees. 1050 means Rs 10.50.',
};
const transactionType = { type: 'string', enum: ['deposit', 'withdrawal', 'transfer'] };
const ruleCode = { type: 'string', enum: ['LARGE_TRANSACTION', 'RAPID_TRANSFERS'] };
const severity = { type: 'string', enum: ['medium', 'high'] };
const decision = { type: 'string', enum: ['approved', 'rejected'] };
const query = (name, schema, description) => ({ in: 'query', name, schema, description });
const id = { in: 'path', name: 'id', required: true, schema: uuid };
const key = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  description:
    'Reuse the same key and normalized body for retries. Different input with the same key is refused.',
  schema: { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' },
  example: '7c68281a-82e3-4970-98d7-77607cdf40b5',
};
const paging = [
  query(
    'limit',
    { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    'Invalid limits are rejected, not clamped.'
  ),
  query(
    'cursor',
    { type: 'string', maxLength: 300 },
    'Opaque continuation token. Repeat the original filters on subsequent pages.'
  ),
  query('from', timestamp, 'Inclusive lower bound, with an explicit time zone.'),
  query('to', timestamp, 'Exclusive upper bound, later than from.'),
];
const historyFilters = [query('type', transactionType, 'Ledger transaction type.'), ...paging];
const replayHeaders = {
  'Idempotent-Replayed': {
    description: 'Present with value true only when an existing operation is replayed.',
    schema: { type: 'string', enum: ['true'] },
  },
};
const errorDescriptions = {
  400: 'Invalid JSON, body, path, query or required Idempotency-Key.',
  401: 'Missing, invalid or expired credentials; login also uses INVALID_CREDENTIALS.',
  403: 'Insufficient role or forbidden self-review.',
  404: 'Resource missing or not accessible. Customer routes conceal another user’s resources.',
  409: 'Conflict: email taken, inactive account or application already reviewed.',
  413: 'JSON body exceeds the 10 KB limit.',
  415: 'Unsupported request encoding or JSON character set.',
  422: 'Valid input refused by a business rule, including insufficient funds, ineligibility or key reuse.',
  429: 'Rate limit exceeded. Retry after the Retry-After interval.',
  500: 'Internal error; implementation details are hidden. A money movement is rolled back on monitoring failure.',
};
function operation(summary, tag, code, schema, options = {}) {
  const {
    public: isPublic = false,
    errors = [],
    parameters = [],
    body,
    description = '',
    replay = false,
  } = options;
  const statuses = new Set([
    ...errors,
    ...(isPublic ? [] : [401]),
    ...(body ? [413, 415] : []),
    429,
    500,
  ]);
  return {
    summary,
    tags: [tag],
    description,
    security: isPublic ? [] : [{ bearerAuth: [] }],
    parameters,
    ...(body
      ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } }
      : {}),
    responses: {
      [code]: {
        description: 'Success',
        content: { 'application/json': { schema } },
        ...(replay ? { headers: replayHeaders } : {}),
      },
      ...Object.fromEntries(
        [...statuses].map((status) => [status, { $ref: `#/components/responses/Error${status}` }])
      ),
    },
  };
}

const quoteInput = {
  principal: {
    type: 'integer',
    minimum: 100000,
    maximum: 100000000,
    example: 10000000,
    description: 'Whole paise: Rs 1,000 to Rs 10 lakh.',
  },
  tenureMonths: { type: 'integer', minimum: 6, maximum: 360, example: 12 },
  monthlyIncome: {
    type: 'integer',
    minimum: 1,
    maximum: 100000000,
    example: 5000000,
    description: 'Self-declared monthly income in paise. Valid input may still be ineligible.',
  },
  existingMonthlyEmi: { type: 'integer', minimum: 0, maximum: 100000000, default: 0 },
};
const schemas = {
  Error: object({
    error: object(
      {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { description: 'Optional validation details or eligibility reason codes.' },
      },
      ['code', 'message']
    ),
  }),
  User: object({
    id: uuid,
    email: { type: 'string', format: 'email' },
    fullName: { type: 'string' },
    role: { type: 'string', enum: ['user', 'admin'] },
    createdAt: timestamp,
  }),
  RegisterInput: {
    ...object({
      email: { type: 'string', format: 'email' },
      fullName: { type: 'string', minLength: 2, maxLength: 100 },
      password: {
        type: 'string',
        minLength: 8,
        writeOnly: true,
        description:
          'At least one ASCII letter and digit; maximum 72 UTF-8 bytes. Name/email are trimmed and email lowercased.',
      },
    }),
    additionalProperties: true,
    description: 'Unknown fields, including role, are dropped. Registration always creates a user.',
  },
  LoginInput: {
    ...object({
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1, writeOnly: true },
    }),
    additionalProperties: true,
  },
  Account: object({
    id: uuid,
    accountNumber: { type: 'string', pattern: '^[1-9][0-9]{11}$' },
    type: { type: 'string', enum: ['savings', 'current'] },
    balance: money,
    currency: { type: 'string', enum: ['INR'] },
    status: { type: 'string', enum: ['active', 'frozen', 'closed'] },
    createdAt: timestamp,
  }),
  AccountInput: {
    ...object({ type: { type: 'string', enum: ['savings', 'current'] } }),
    additionalProperties: true,
    description:
      'Owner, number, balance, currency and status are server-owned; extra fields are ignored.',
  },
  MovementInput: {
    ...object(
      {
        accountId: uuid,
        amount: {
          type: 'integer',
          minimum: 1,
          maximum: 1000000000,
          description: 'Whole paise; JSON strings and fractional values are refused.',
        },
        description: {
          type: 'string',
          maxLength: 140,
          description: 'Optional trimmed description.',
        },
      },
      ['accountId', 'amount']
    ),
    additionalProperties: true,
  },
  TransferInput: {
    ...object(
      {
        fromAccountId: uuid,
        toAccountNumber: { type: 'string', pattern: '^[1-9][0-9]{11}$' },
        amount: { type: 'integer', minimum: 1, maximum: 1000000000 },
        description: { type: 'string', maxLength: 140 },
      },
      ['fromAccountId', 'toAccountNumber', 'amount']
    ),
    additionalProperties: true,
  },
  Transaction: object({
    id: uuid,
    type: transactionType,
    fromAccountId: nullableUuid,
    toAccountId: nullableUuid,
    amount: money,
    status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
    description: nullableText,
    createdAt: timestamp,
  }),
  HistoryTransaction: object({
    id: uuid,
    type: transactionType,
    direction: { type: 'string', enum: ['credit', 'debit', 'internal'] },
    amount: money,
    status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
    description: nullableText,
    createdAt: timestamp,
    fromAccountId: nullableUuid,
    toAccountId: nullableUuid,
    counterpartyAccountNumber: nullableText,
  }),
  Pagination: object({
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    hasMore: { type: 'boolean' },
    nextCursor: nullableText,
  }),
  QuoteInput: {
    ...object(quoteInput, ['principal', 'tenureMonths', 'monthlyIncome']),
    additionalProperties: true,
    description: 'Unknown fields are dropped. Rate and eligibility are controlled by the server.',
  },
  Installment: object({
    month: { type: 'integer', minimum: 1 },
    payment: money,
    principal: money,
    interest: money,
    balance: money,
  }),
  Eligibility: object({
    eligible: { type: 'boolean' },
    reasons: array({ type: 'string', enum: ['INCOME_BELOW_MINIMUM', 'DEBT_TO_INCOME_EXCEEDED'] }),
    maxMonthlyDebt: money,
  }),
  Quote: object({
    principal: money,
    tenureMonths: { type: 'integer', minimum: 6, maximum: 360 },
    annualRateBps: { type: 'integer', enum: [1200] },
    currency: { type: 'string', enum: ['INR'] },
    emi: money,
    totalInterest: money,
    totalRepayment: money,
    schedule: array(ref('Installment')),
    eligibility: ref('Eligibility'),
  }),
  ReviewInput: {
    ...object({
      decision,
      reason: {
        type: 'string',
        minLength: 10,
        maxLength: 500,
        description:
          'Trimmed, customer-visible explanation, 10–500 Unicode characters. Null bytes and lone surrogates are refused; do not put private notes here.',
      },
    }),
    additionalProperties: true,
  },
  Application: object({
    id: uuid,
    principal: money,
    tenureMonths: { type: 'integer' },
    monthlyIncome: money,
    existingMonthlyEmi: money,
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    quote: ref('Quote'),
    createdAt: timestamp,
    review: { ...object({ reason: { type: 'string' }, reviewedAt: timestamp }), nullable: true },
  }),
  AuditLog: object({
    id: uuid,
    userId: nullableUuid,
    action: { type: 'string', enum: ACTION_NAMES },
    outcome: { type: 'string', enum: ['success', 'failure'] },
    statusCode: { type: 'integer' },
    ipAddress: nullableText,
    metadata: { type: 'object', additionalProperties: true },
    createdAt: timestamp,
  }),
  LargeEvidence: object({
    amount: money,
    thresholdPaise: { type: 'integer', enum: [10000000] },
    ruleVersion: { type: 'integer', enum: [1] },
  }),
  RapidEvidence: object({
    countAtLeast: { type: 'integer', enum: [5] },
    windowSeconds: { type: 'integer', enum: [300] },
    ruleVersion: { type: 'integer', enum: [1] },
  }),
  Alert: object({
    id: uuid,
    transactionId: uuid,
    accountId: uuid,
    ruleCode,
    severity,
    details: { oneOf: [ref('LargeEvidence'), ref('RapidEvidence')] },
    createdAt: timestamp,
  }),
};
const movementResponse = object({ transaction: ref('Transaction'), account: ref('Account') });
const historyResponse = object({
  transactions: array(ref('HistoryTransaction')),
  pagination: ref('Pagination'),
});
const applicationResponse = object({ application: ref('Application') });
const adminDescription =
  'Admin JWT required. These loan/alert routes also recheck the current database role. No self-review; approval does not disburse funds.';
const paths = {
  '/health': {
    get: {
      ...operation(
        'Check application and database health',
        'Health',
        200,
        object({
          status: { type: 'string', enum: ['ok'] },
          database: { type: 'string', enum: ['up'] },
        }),
        { public: true }
      ),
      responses: {
        200: {
          description: 'Database reachable',
          content: {
            'application/json': {
              schema: object({
                status: { type: 'string', enum: ['ok'] },
                database: { type: 'string', enum: ['up'] },
              }),
            },
          },
        },
        500: { $ref: '#/components/responses/Error500' },
      },
    },
  },
  '/auth/register': {
    post: operation('Register a user', 'Authentication', 201, object({ user: ref('User') }), {
      public: true,
      body: 'RegisterInput',
      errors: [400, 409],
    }),
  },
  '/auth/login': {
    post: operation(
      'Log in and obtain an access token',
      'Authentication',
      200,
      object({ token: { type: 'string' }, user: ref('User') }),
      { public: true, body: 'LoginInput', errors: [400, 401] }
    ),
  },
  '/auth/me': {
    get: operation(
      'Read the current user from the database',
      'Authentication',
      200,
      object({ user: ref('User') })
    ),
  },
  '/accounts': {
    post: operation('Open an account', 'Accounts', 201, object({ account: ref('Account') }), {
      body: 'AccountInput',
      errors: [400],
    }),
    get: operation(
      'List your accounts',
      'Accounts',
      200,
      object({ accounts: array(ref('Account')) })
    ),
  },
  '/accounts/{id}': {
    get: operation('Read your account', 'Accounts', 200, object({ account: ref('Account') }), {
      parameters: [id],
      errors: [400, 404],
    }),
  },
  '/accounts/{id}/transactions': {
    get: operation(
      'Read transaction history for your account',
      'Transactions',
      200,
      historyResponse,
      {
        parameters: [id, ...historyFilters],
        errors: [400, 404],
        description: 'Other people’s account ids are hidden; counterparty numbers are masked.',
      }
    ),
  },
  '/transactions': {
    get: operation('Read history across your accounts', 'Transactions', 200, historyResponse, {
      parameters: [query('accountId', uuid, 'Optional owned account filter.'), ...historyFilters],
      errors: [400, 404],
      description:
        'Newest first. Cursors preserve database microseconds; no page numbers or total count.',
    }),
  },
  '/transactions/deposit': {
    post: operation('Deposit demo funds', 'Transactions', 201, movementResponse, {
      body: 'MovementInput',
      parameters: [key],
      errors: [400, 404, 409, 422],
      replay: true,
      description:
        'Educational funding operation, not an integration with a real payment rail. Retries return the original transaction and current account state.',
    }),
  },
  '/transactions/withdraw': {
    post: operation('Withdraw demo funds', 'Transactions', 201, movementResponse, {
      body: 'MovementInput',
      parameters: [key],
      errors: [400, 404, 409, 422],
      replay: true,
      description:
        'Ownership, active status and available funds are checked under a row lock. Monitoring failures roll back the movement.',
    }),
  },
  '/transactions/transfer': {
    post: operation('Transfer atomically between accounts', 'Transactions', 201, movementResponse, {
      body: 'TransferInput',
      parameters: [key],
      errors: [400, 404, 409, 422],
      replay: true,
      description:
        'Source must be yours. Destination is addressed by its 12-digit number; missing/inactive destinations share one 404. Account locks use fixed id order. Retry transaction is stable; returned account state is current.',
    }),
  },
  '/loans/quote': {
    post: operation(
      'Calculate an indicative loan quote',
      'Loans',
      200,
      object({ quote: ref('Quote') }),
      {
        body: 'QuoteInput',
        errors: [400],
        description:
          'Read-only. Fixed nominal annual rate 12%; half-up paise rounding; final payment adjusts the residual. Minimum declared income Rs 15,000; existing EMI plus largest installment at most 40% of income. Ineligibility is a 200 calculation result, not loan approval.',
      }
    ),
  },
  '/loans/applications': {
    post: operation('Submit an eligible pending application', 'Loans', 201, applicationResponse, {
      body: 'QuoteInput',
      parameters: [key],
      errors: [400, 422],
      replay: true,
      description:
        'Recalculates eligibility, saves a quote snapshot and never moves money. Keys are scoped per user. A replay preserves saved terms but returns current review status. Different keys may create multiple applications; aggregate exposure is not enforced.',
    }),
  },
  '/loans/applications/{id}': {
    get: operation('Read your application and review', 'Loans', 200, applicationResponse, {
      parameters: [id],
      errors: [400, 404],
    }),
  },
  '/admin/loan-applications/{id}': {
    get: operation(
      'Inspect a loan application as admin',
      'Administration',
      200,
      applicationResponse,
      { parameters: [id], errors: [400, 403, 404], description: adminDescription }
    ),
  },
  '/admin/loan-applications/{id}/review': {
    post: operation(
      'Approve or reject a pending application',
      'Administration',
      200,
      applicationResponse,
      {
        body: 'ReviewInput',
        parameters: [id],
        errors: [400, 403, 404, 409],
        replay: true,
        description: `${adminDescription} One terminal decision wins. Same reviewer, decision and normalized reason replay without a key; changing any of them after completion gives 409.`,
      }
    ),
  },
  '/admin/audit-logs': {
    get: operation(
      'Read the append-only request audit log',
      'Administration',
      200,
      object({ logs: array(ref('AuditLog')), pagination: ref('Pagination') }),
      {
        parameters: [
          query('action', { type: 'string', enum: ACTION_NAMES }, 'Recorded action.'),
          query('outcome', { type: 'string', enum: ['success', 'failure'] }, 'Request outcome.'),
          query('userId', uuid, 'Actor id.'),
          ...paging,
        ],
        errors: [400, 403],
        description:
          'Admin JWT role is trusted until expiry on this endpoint. Audit writes are best-effort after the response, not guaranteed durable financial evidence.',
      }
    ),
  },
  '/admin/alerts': {
    get: operation(
      'List monitoring alerts',
      'Administration',
      200,
      object({ alerts: array(ref('Alert')), pagination: ref('Pagination') }),
      {
        parameters: [
          query('ruleCode', ruleCode, 'Demo monitoring rule.'),
          query('severity', severity, 'Demo severity label.'),
          query('accountId', uuid, 'Subject account.'),
          query('transactionId', uuid, 'Ledger transaction.'),
          ...paging,
        ],
        errors: [400, 403],
        description: `${adminDescription} Large movement threshold: Rs 1 lakh. Rapid transfers: fifth and later outgoing transfers in five minutes. Alerts flag activity, not proven fraud.`,
      }
    ),
  },
  '/admin/alerts/{id}': {
    get: operation(
      'Read a monitoring alert',
      'Administration',
      200,
      object({ alert: ref('Alert') }),
      { parameters: [id], errors: [400, 403, 404], description: adminDescription }
    ),
  },
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Mini Digital Banking API',
    version: '1.0.0',
    description:
      'Educational banking API. All monetary values are integer paise. Unknown request fields are dropped. No real payment rails, loan disbursement or repayment collection. Swagger Try it out sends real requests to this server; use only disposable demo data.',
  },
  servers: [{ url: '/api/v1', description: 'Same-origin API' }],
  tags: ['Health', 'Authentication', 'Accounts', 'Transactions', 'Loans', 'Administration'].map(
    (name) => ({ name })
  ),
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas,
    responses: Object.fromEntries(
      Object.entries(errorDescriptions).map(([code, description]) => [
        `Error${code}`,
        {
          description,
          content: { 'application/json': { schema: ref('Error') } },
          ...(code === '429'
            ? {
                headers: {
                  'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' },
                },
              }
            : {}),
        },
      ])
    ),
  },
};
