const dotenv = require('dotenv');
const { z } = require('zod');

// Tests load .env.test (the test database); everything else loads .env
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: envFile, quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
});

module.exports = schema.parse(process.env);
