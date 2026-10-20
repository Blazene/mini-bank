const transactionsService = require('./transactions.service');

// Express 5 passes errors from async handlers to the error handler automatically.
// A replay answers exactly like the original request did (201 and the same body), and adds
// a header so a client or a log can tell the money was NOT moved a second time.
function respond(res, { replayed, ...body }) {
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(201).json(body);
}

async function deposit(req, res) {
  const result = await transactionsService.deposit(req.user.id, {
    ...req.body,
    idempotencyKey: req.idempotencyKey,
  });
  respond(res, result);
}

async function withdraw(req, res) {
  const result = await transactionsService.withdraw(req.user.id, {
    ...req.body,
    idempotencyKey: req.idempotencyKey,
  });
  respond(res, result);
}

module.exports = { deposit, withdraw };
