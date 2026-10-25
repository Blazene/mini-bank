const { z } = require('zod');
const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  dateTimeSchema,
  limitSchema,
  cursorSchema,
  withRangeCheck,
} = require('../../shared/validation/pagination.schema');

const typeSchema = z.enum(['deposit', 'withdrawal', 'transfer'], {
  error: 'Type must be deposit, withdrawal or transfer',
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
