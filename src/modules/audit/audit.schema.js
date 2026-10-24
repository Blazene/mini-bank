const { z } = require('zod');
const {
  dateTimeSchema,
  limitSchema,
  cursorSchema,
  withRangeCheck,
} = require('../transactions/history.schema');
const { ACTION_NAMES } = require('./audit.actions');

// Query rules for GET /admin/audit-logs. The limit, date and cursor rules are the same ones the
// transaction history uses (maximum 100 per page, dates with a time zone, [from, to)).
const auditLogsQuerySchema = withRangeCheck(
  z.object({
    action: z
      .enum(ACTION_NAMES, { error: `Action must be one of: ${ACTION_NAMES.join(', ')}` })
      .optional(),
    outcome: z
      .enum(['success', 'failure'], { error: 'Outcome must be success or failure' })
      .optional(),
    userId: z.uuid('User id must be a valid UUID').optional(),
    from: dateTimeSchema.optional(),
    to: dateTimeSchema.optional(),
    limit: limitSchema,
    cursor: cursorSchema.optional(),
  })
);

module.exports = { auditLogsQuerySchema };
