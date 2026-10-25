const { z } = require('zod');

// Demo lending policy, not a credit decision. All money is integer paise.
const quoteSchema = z.object({
  principal: z.number().int().min(100_000).max(100_000_000),
  tenureMonths: z.number().int().min(6).max(360),
  monthlyIncome: z.number().int().min(1).max(100_000_000),
  existingMonthlyEmi: z.number().int().min(0).max(100_000_000).default(0),
});

const applicationIdSchema = z.object({ id: z.uuid('Application id must be a valid UUID') });

module.exports = { quoteSchema, applicationIdSchema };
