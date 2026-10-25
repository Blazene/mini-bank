const { z } = require('zod');

// Demo lending policy, not a credit decision. All money is integer paise.
const quoteSchema = z.object({
  principal: z.number().int().min(100_000).max(100_000_000),
  tenureMonths: z.number().int().min(6).max(360),
  monthlyIncome: z.number().int().min(1).max(100_000_000),
  existingMonthlyEmi: z.number().int().min(0).max(100_000_000).default(0),
});

const applicationIdSchema = z.object({ id: z.uuid('Application id must be a valid UUID') });

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  // Customer-visible explanation, not private underwriting notes.
  reason: z
    .string()
    .trim()
    // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
    .refine(
      (text) => [...text].length >= 10 && [...text].length <= 500,
      'Reason must contain 10 to 500 characters'
    )
    .refine((text) => !/[\u0000\uD800-\uDFFF]/u.test(text), 'Reason contains unsupported text'),
});

module.exports = { quoteSchema, applicationIdSchema, reviewSchema };
