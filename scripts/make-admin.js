// Operator tool, not part of the API. Usage: npm run make-admin -- someone@example.com
// Gives an existing user the admin role and records that in the audit log.
// The person must log in again afterwards: the role is stored inside their login token.
const { pool } = require('../src/config/db');
const authRepository = require('../src/modules/auth/auth.repository');
const auditRepository = require('../src/modules/audit/audit.repository');

// Returns the updated user, or null if no user has that email.
async function grantAdmin(email) {
  const user = await authRepository.setRoleByEmail(email, 'admin');
  if (!user) return null;

  await auditRepository.insert({
    userId: user.id,
    action: 'admin.role_granted',
    outcome: 'success',
    statusCode: 200,
    ipAddress: null,
    metadata: { email: user.email, via: 'make-admin script' },
  });
  return user;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run make-admin -- someone@example.com');
    process.exitCode = 1;
    return;
  }

  const user = await grantAdmin(email);
  if (!user) {
    console.error(`No user with the email ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${user.email} is now an admin. They must log in again to get a new token.`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { grantAdmin };
