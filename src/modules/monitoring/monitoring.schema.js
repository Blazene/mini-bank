const { z } = require('zod');
const {
  dateTimeSchema,
  limitSchema,
  cursorSchema,
  withRangeCheck,
} = require('../../shared/validation/pagination.schema');

const querySchema = withRangeCheck(
  z.object({
    ruleCode: z.enum(['LARGE_TRANSACTION', 'RAPID_TRANSFERS']).optional(),
    severity: z.enum(['medium', 'high']).optional(),
    accountId: z.uuid().optional(),
    transactionId: z.uuid().optional(),
    from: dateTimeSchema.optional(),
    to: dateTimeSchema.optional(),
    limit: limitSchema,
    cursor: cursorSchema.optional(),
  })
);
const idSchema = z.object({ id: z.uuid('Alert id must be a valid UUID') });

module.exports = { querySchema, idSchema };
