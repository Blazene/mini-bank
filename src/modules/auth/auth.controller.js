const authService = require('./auth.service');

// Express 5 passes errors from async handlers to the error handler automatically.
async function register(req, res) {
  const user = await authService.register(req.body);
  res.status(201).json({ user });
}

module.exports = { register };
