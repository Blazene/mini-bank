const db = require('../../config/db');

// Convert a database row (snake_case) into the object the app uses (camelCase).
// It deliberately leaves out password_hash so it can never leak by accident.
const toUser = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  role: row.role,
  createdAt: row.created_at,
});

async function createUser({ email, fullName, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, full_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, full_name, role, created_at`,
    [email, fullName, passwordHash]
  );
  return toUser(rows[0]);
}

// Used only by login. This is the one place the hash is read, and it never leaves the service.
// lower(email) matches the users_email_unique index, so the lookup is fast.
async function findByEmailWithHash(email) {
  const { rows } = await db.query(
    `SELECT id, email, full_name, role, created_at, password_hash
     FROM users
     WHERE lower(email) = lower($1)`,
    [email]
  );
  if (rows.length === 0) return null;
  return { user: toUser(rows[0]), passwordHash: rows[0].password_hash };
}

module.exports = { createUser, findByEmailWithHash };
