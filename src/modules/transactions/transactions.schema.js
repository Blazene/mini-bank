const { z } = require('zod');

// Largest single deposit, withdrawal or transfer: 1 crore rupees, written in paise. This limits
// the damage of a typo or abuse. The service separately refuses any credit that would push a
// balance past the largest number JavaScript can hold exactly.
const MAX_AMOUNT_PAISE = 1_000_000_000;

// Amounts are whole numbers of paise sent as JSON numbers: no decimals, no strings.
// 10.50 rupees is 1050. Floating point cannot hold decimal money exactly, so we never accept it.
const amountSchema = z
  .number('Amount must be a number of paise')
  .int('Amount must be a whole number of paise')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT_PAISE, `Amount cannot be more than ${MAX_AMOUNT_PAISE} paise`);

const descriptionSchema = z.string().trim().max(140, 'Description is too long').optional();

const moneyMovementSchema = z.object({
  accountId: z.uuid('Account id must be a valid UUID'),
  amount: amountSchema,
  description: descriptionSchema,
});

// The sender names their own account by id. The recipient is named by the 12-digit account
// number a person actually knows, because nobody can see another person's account id.
const transferSchema = z.object({
  fromAccountId: z.uuid('Account id must be a valid UUID'),
  toAccountNumber: z
    .string('Account number must be text')
    .regex(/^[1-9]\d{11}$/, 'Account number must be 12 digits'),
  amount: amountSchema,
  description: descriptionSchema,
});

module.exports = { moneyMovementSchema, transferSchema, MAX_AMOUNT_PAISE };
