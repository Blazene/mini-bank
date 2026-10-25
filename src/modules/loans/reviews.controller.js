const service = require('./reviews.service');

async function get(req, res) {
  res.status(200).json({ application: await service.get(req.user.id, req.params.id) });
}

async function review(req, res) {
  const { application, replayed } = await service.review(req.user.id, req.params.id, req.body);
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(200).json({ application });
}

module.exports = { get, review };
