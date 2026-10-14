const { z } = require('zod');

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

// bcrypt only uses the first 72 BYTES of a password, so we cap it there
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long (72 bytes maximum)')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  email,
  fullName: z.string().trim().min(2, 'Name is too short').max(100, 'Name is too long'),
  password,
});

// At login we only check the password is present. Strength rules apply when it is created.
const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

module.exports = { registerSchema, loginSchema };
