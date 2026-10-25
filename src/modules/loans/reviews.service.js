const AppError = require('../../shared/utils/AppError');
const users = require('../auth/auth.repository');
const repository = require('./applications.repository');
const { reviewSchema } = require('./loans.schema');

async function assertCurrentAdmin(userId) {
  // The router checks the JWT role as well. Recheck here so a previously issued
  // admin token cannot authorize NEW requests after the database role is revoked.
  const user = await users.findById(userId);
  if (!user) throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  if (user.role !== 'admin') throw new AppError('Admin access required', 403, 'FORBIDDEN');
}

async function load(id) {
  const record = await repository.findForReview(id);
  if (!record) throw new AppError('Loan application not found', 404, 'LOAN_APPLICATION_NOT_FOUND');
  return record;
}

async function get(adminId, id) {
  await assertCurrentAdmin(adminId);
  return (await load(id)).application;
}

function replay(record, adminId, decision, reason) {
  if (
    record.reviewerId === adminId &&
    record.application.status === decision &&
    record.application.review.reason === reason
  ) {
    return { application: record.application, replayed: true };
  }
  throw new AppError('Loan application has already been reviewed', 409, 'LOAN_ALREADY_REVIEWED');
}

async function review(adminId, id, body) {
  await assertCurrentAdmin(adminId);
  const { decision, reason } = reviewSchema.parse(body);
  const record = await load(id);
  if (record.applicantId === adminId) {
    throw new AppError('You cannot review your own application', 403, 'SELF_REVIEW_FORBIDDEN');
  }
  if (record.application.status !== 'pending') return replay(record, adminId, decision, reason);
  const application = await repository.decidePending(id, adminId, decision, reason);
  if (application) return { application, replayed: false };
  return replay(await load(id), adminId, decision, reason);
}

module.exports = { get, review };
