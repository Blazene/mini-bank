const dotenv = require('dotenv');
const { z } = require('zod');

// Tests load .env.test (the test database); everything else loads .env
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: envFile, quiet: true });

function isOrigin(text) {
  try {
    const url = new URL(text);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === text &&
      !url.hostname.includes('*')
    );
  } catch {
    return false;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  // z.coerce.boolean() would turn the text "false" into true, so we compare the text ourselves.
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // How many proxies sit in front of the app (0 when clients connect directly). It decides
  // whether X-Forwarded-For is believed, which decides what "the client IP" means.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Empty means no cross-origin browser access in production; same-origin Swagger works.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((text) =>
      text
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    )
    .refine(
      (origins) => origins.every(isOrigin),
      'CORS_ORIGINS must be exact http(s) origins without paths or wildcards'
    ),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
});

module.exports = schema.parse(process.env);
