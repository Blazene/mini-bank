const service = require('./loans.service');

function quote(req, res) {
  res.status(200).json({ quote: service.quote(req.body) });
}

module.exports = { quote };
