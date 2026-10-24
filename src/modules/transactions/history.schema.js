const { z } = require('zod');
const { decodeCursor } = require('./history.cursor');
const { isRealCalendarDate } = require('../../shared/utils/calendar');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Query strings arrive as text, so numbers and dates are converted here, once, at the edge.

// Dates must carry a time zone (2026-10-01T00:00:00Z or ...+05:30). Without one, "midnight"
// would mean a different moment on every server. Zod checks the shape and that the day exists
// (it rejects 2026-02-30). It lets year 0000 through, which PostgreSQL refuses with an error
// that would become a 500, so that is checked as well. abort: true stops at the first problem.
const dateTimeSchema = z.iso
  .datetime({
    offset: true,
    abort: true,
    error: 'Must be an ISO 8601 date and time with a time zone, like 2026-10-01T00:00:00Z',
  })
  .refine(isRealCalendarDate, { error: 'That date is not supported', abort: true })
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()), 'That date is not valid');

// A bad limit is refused, not silently clamped, so a client bug shows up instead of hiding.
const limitSchema = z
  .string()
  .regex(/^\d+$/, 'Limit must be a whole number')
  .transform(Number)
  .pipe(
    z
      .number()
      .min(1, 'Limit must be at least 1')
      .max(MAX_LIMIT, `Limit cannot be more than ${MAX_LIMIT}`)
  )
  .default(DEFAULT_LIMIT);

const typeSchema = z.enum(['deposit', 'withdrawal', 'transfer'], {
  error: 'Type must be deposit, withdrawal or transfer',
});

// The cursor is decoded and checked here. Later code receives { createdAt, id }.
const cursorSchema = z
  .string()
  .max(300, 'Cursor is not valid')
  .refine((text) => decodeCursor(text) !== null, 'Cursor is not valid')
  .transform((text) => decodeCursor(text));

// from is included, to is excluded: [from, to). Back-to-back ranges never overlap.
const withRangeCheck = (schema) =>
  schema.refine((query) => !query.from || !query.to || query.from < query.to, {
    error: 'from must be earlier than to',
    path: ['from'],
  });

const sharedFilters = {
  type: typeSchema.optional(),
  from: dateTimeSchema.optional(),
  to: dateTimeSchema.optional(),
  limit: limitSchema,
  cursor: cursorSchema.optional(),
};

// GET /transactions: everything touching the caller's accounts, optionally one account.
const listTransactionsQuerySchema = withRangeCheck(
  z.object({
    ...sharedFilters,
    accountId: z.uuid('Account id must be a valid UUID').optional(),
  })
);

// GET /accounts/:id/transactions: the account comes from the path, so it is not a filter.
const accountTransactionsQuerySchema = withRangeCheck(z.object(sharedFilters));

module.exports = {
  listTransactionsQuerySchema,
  accountTransactionsQuerySchema,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  // Building blocks that other list endpoints reuse (the audit log does).
  dateTimeSchema,
  limitSchema,
  cursorSchema,
  withRangeCheck,
};
