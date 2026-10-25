const service = require('./monitoring.service');

async function list(req, res) {
  res.status(200).json(await service.list(req.user.id, req.query));
}
async function get(req, res) {
  res.status(200).json({ alert: await service.get(req.user.id, req.params.id) });
}

module.exports = { list, get };
