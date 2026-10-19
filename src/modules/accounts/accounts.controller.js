const accountsService = require('./accounts.service');

// Express 5 passes errors from async handlers to the error handler automatically.
async function create(req, res) {
  const account = await accountsService.createAccount(req.user.id, req.body);
  res.status(201).json({ account });
}

async function list(req, res) {
  const accounts = await accountsService.listAccounts(req.user.id);
  res.status(200).json({ accounts });
}

async function get(req, res) {
  const account = await accountsService.getAccount(req.user.id, req.params.id);
  res.status(200).json({ account });
}

module.exports = { create, list, get };
