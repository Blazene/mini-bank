const historyService = require('./history.service');

// req.query was already checked and cleaned by validate(..., 'query').
async function list(req, res) {
  const result = await historyService.listHistory(req.user.id, req.query);
  res.status(200).json(result);
}

// Same history, restricted to the account named in the URL.
async function listForAccount(req, res) {
  const result = await historyService.listHistory(req.user.id, {
    ...req.query,
    accountId: req.params.id,
  });
  res.status(200).json(result);
}

module.exports = { list, listForAccount };
