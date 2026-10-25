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
  // pg query parameters can override the authority, so do not validate one host
  // and then connect to another (potentially transaction-pooled) host.
  if (url.searchParams.has('host')) {
    throw new Error('DATABASE_URL must not contain a host query override');
  }
  const hostname = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/, '');
  if (hostname.endsWith('.neon.tech')) {
    if (hostname.includes('-pooler.')) {
      throw new Error('Use a direct Neon connection, not the pooled endpoint, for startup migrations');
    }
    const modes = url.searchParams.getAll('sslmode');
    if (modes.length !== 1 || modes[0] !== 'verify-full') {
      throw new Error('Use exactly one sslmode=verify-full for the Neon connection');
    }
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      throw new Error('Do not disable TLS certificate verification for Neon');
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
