const authService = require('./auth.service');

// res.locals.auditUserId tells the audit middleware who just registered or logged in. It is
// not known until the work is done, so the middleware cannot read it from a token.

// Express 5 passes errors from async handlers to the error handler automatically.
async function register(req, res) {
  const user = await authService.register(req.body);
  res.locals.auditUserId = user.id;
  res.status(201).json({ user });
}

async function login(req, res) {
  const { token, user } = await authService.login(req.body);
  res.locals.auditUserId = user.id;
  res.status(200).json({ token, user });
}

async function me(req, res) {
  const user = await authService.getCurrentUser(req.user.id);
  res.status(200).json({ user });
}

module.exports = { register, login, me };
