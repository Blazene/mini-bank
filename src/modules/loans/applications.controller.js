const service = require('./applications.service');

async function apply(req, res) {
  const { application, replayed } = await service.apply(req.user.id, req.body, req.idempotencyKey);
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(201).json({ application });
}

async function get(req, res) {
  const application = await service.get(req.user.id, req.params.id);
  res.status(200).json({ application });
}

module.exports = { apply, get };
