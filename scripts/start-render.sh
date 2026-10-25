#!/bin/sh
set -eu

# Free Render services have no pre-deploy job. Validate before touching the DB,
# migrate on a direct connection, then replace this shell with the API process.
node -e "
try {
  const env = require('./src/config/env');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }
  if (url.hostname.endsWith('.neon.tech')) {
    if (url.hostname.includes('-pooler.')) {
      throw new Error('Use a direct Neon connection, not the pooled endpoint, for startup migrations');
    }
    if (url.searchParams.get('sslmode') !== 'verify-full') {
      throw new Error('Use sslmode=verify-full for the Neon connection');
    }
  }
} catch (err) {
  // Print only the message: URL errors can carry the credential-bearing input.
  console.error(err.message);
  process.exit(1);
}
"
npm run migrate -- up
exec node src/server.js
