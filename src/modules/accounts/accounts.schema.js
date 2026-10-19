const { z } = require('zod');

// The client may only choose the account type. Balance, status, owner and account number
// are set by the server, and Zod drops any other field the client sends.
const createAccountSchema = z.object({
  type: z.enum(['savings', 'current'], { error: 'Type must be savings or current' }),
});

const accountIdParamsSchema = z.object({
  id: z.uuid('Account id must be a valid UUID'),
});

module.exports = { createAccountSchema, accountIdParamsSchema };
