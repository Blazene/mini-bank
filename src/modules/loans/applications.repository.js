const db = require('../../config/db');
const { paiseToNumber } = require('../../shared/utils/money');

const COLUMNS = `id, principal, tenure_months, monthly_income, existing_monthly_emi,
                 status, quote, created_at, review_reason, reviewed_at`;
const present = (row) => ({
  id: row.id,
  principal: paiseToNumber(row.principal),
  tenureMonths: row.tenure_months,
  monthlyIncome: paiseToNumber(row.monthly_income),
  existingMonthlyEmi: paiseToNumber(row.existing_monthly_emi),
  status: row.status,
  quote: row.quote,
  createdAt: row.created_at,
  review: row.reviewed_at ? { reason: row.review_reason, reviewedAt: row.reviewed_at } : null,
});

async function findByKey(userId, key) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM loan_applications WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key]
  );
  return rows.length ? present(rows[0]) : null;
}

async function insert(userId, input, key, quote) {
  const { rows } = await db.query(
    `INSERT INTO loan_applications
       (user_id, principal, tenure_months, monthly_income, existing_monthly_emi, idempotency_key, quote)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      userId,
      input.principal,
      input.tenureMonths,
      input.monthlyIncome,
      input.existingMonthlyEmi,
      key,
      JSON.stringify(quote),
    ]
  );
  return rows.length ? present(rows[0]) : null;
}

async function findForUser(id, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM loan_applications WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows.length ? present(rows[0]) : null;
}

// Admin-only service entry point: unlike findForUser, this does NOT enforce ownership.
async function findForReview(id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, user_id, reviewed_by FROM loan_applications WHERE id = $1`,
    [id]
  );
  if (!rows.length) return null;
  return {
    application: present(rows[0]),
    applicantId: rows[0].user_id,
    reviewerId: rows[0].reviewed_by,
  };
}

async function decidePending(id, reviewerId, status, reason) {
  // Compare-and-set: PostgreSQL rechecks pending after waiting for another updater.
  // Only one competing decision can win; never overwrite a completed review.
  const { rows } = await db.query(
    `UPDATE loan_applications
     SET status = $3, reviewed_by = $2, review_reason = $4, reviewed_at = now()
     WHERE id = $1 AND status = 'pending' AND user_id <> $2
     RETURNING ${COLUMNS}`,
    [id, reviewerId, status, reason]
  );
  return rows.length ? present(rows[0]) : null;
}

module.exports = { findByKey, insert, findForUser, findForReview, decidePending };
