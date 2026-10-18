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

module.exports = { createUser };
