const AppError = require('../../shared/utils/AppError');
const { quoteSchema } = require('./loans.schema');
const quotes = require('./loans.service');
const repository = require('./applications.repository');

function replay(application, input) {
  const fields = ['principal', 'tenureMonths', 'monthlyIncome', 'existingMonthlyEmi'];
  if (!fields.every((field) => application[field] === input[field])) {
    throw new AppError(
      'Idempotency key was used for a different application',
      422,
      'IDEMPOTENCY_KEY_REUSED'
    );
  }
  return { application, replayed: true };
}

async function apply(userId, body, key) {
  const input = quoteSchema.parse(body);
  const existing = await repository.findByKey(userId, key);
  // A retry returns the saved terms even if the lending policy has since changed.
  if (existing) return replay(existing, input);
  const quote = quotes.quote(input);
  if (!quote.eligibility.eligible) {
    throw new AppError(
      'Loan application does not meet the demo eligibility policy',
      422,
      'LOAN_INELIGIBLE',
      quote.eligibility.reasons
    );
  }
  const application = await repository.insert(userId, input, key, quote);
  if (application) return { application, replayed: false };
  // The unique constraint serializes concurrent same-key inserts. A fresh READ COMMITTED
  // statement sees the winner after ON CONFLICT waits for it to commit.
  const winner = await repository.findByKey(userId, key);
  if (!winner) throw new Error('Concurrent loan application could not be read');
  return replay(winner, input);
}

async function get(userId, id) {
  const application = await repository.findForUser(id, userId);
  if (!application) {
    throw new AppError('Loan application not found', 404, 'LOAN_APPLICATION_NOT_FOUND');
  }
  return application;
}

module.exports = { apply, get };
