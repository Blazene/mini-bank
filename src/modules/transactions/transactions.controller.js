const transactionsService = require('./transactions.service');

// Express 5 passes errors from async handlers to the error handler automatically.
async function deposit(req, res) {
  const result = await transactionsService.deposit(req.user.id, req.body);
  res.status(201).json(result);
}

async function withdraw(req, res) {
  const result = await transactionsService.withdraw(req.user.id, req.body);
  res.status(201).json(result);
}

module.exports = { deposit, withdraw };
