const auditService = require('./audit.service');

// req.query was already checked and cleaned by validate(..., 'query').
async function list(req, res) {
  const result = await auditService.listLogs(req.query);
  res.status(200).json(result);
}

module.exports = { list };
