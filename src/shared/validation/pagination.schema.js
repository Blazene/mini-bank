const { z } = require('zod');
const { decodeCursor } = require('../utils/pagination.cursor');
const { isRealCalendarDate } = require('../utils/calendar');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const dateTimeSchema = z.iso
  .datetime({
    offset: true,
    abort: true,
    error: 'Must be an ISO 8601 date and time with a time zone, like 2026-10-01T00:00:00Z',
  })
  .refine(isRealCalendarDate, { error: 'That date is not supported', abort: true })
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()), 'That date is not valid');

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

const cursorSchema = z
  .string()
  .max(300, 'Cursor is not valid')
  .refine((text) => decodeCursor(text) !== null, 'Cursor is not valid')
  .transform(decodeCursor);

const withRangeCheck = (schema) =>
  schema.refine((query) => !query.from || !query.to || query.from < query.to, {
    error: 'from must be earlier than to',
    path: ['from'],
  });

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  dateTimeSchema,
  limitSchema,
  cursorSchema,
  withRangeCheck,
};
