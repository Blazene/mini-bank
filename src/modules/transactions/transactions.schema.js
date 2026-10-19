const { z } = require('zod');

// Largest single deposit or withdrawal: 1 crore rupees, written in paise. This limits the
// damage of a typo or abuse. The service separately refuses any deposit that would push a
// balance past the largest number JavaScript can hold exactly.
const MAX_AMOUNT_PAISE = 1_000_000_000;

// Amounts are whole numbers of paise sent as JSON numbers: no decimals, no strings.
// 10.50 rupees is 1050. Floating point cannot hold decimal money exactly, so we never accept it.
const moneyMovementSchema = z.object({
  accountId: z.uuid('Account id must be a valid UUID'),
  amount: z
    .number('Amount must be a number of paise')
    .int('Amount must be a whole number of paise')
    .positive('Amount must be greater than zero')
    .max(MAX_AMOUNT_PAISE, `Amount cannot be more than ${MAX_AMOUNT_PAISE} paise`),
  description: z.string().trim().max(140, 'Description is too long').optional(),
});

module.exports = { moneyMovementSchema, MAX_AMOUNT_PAISE };
