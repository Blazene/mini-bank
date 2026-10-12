const AppError = require('../utils/AppError');

module.exports = (req, res, next) => {
  next(new AppError('Route not found', 404, 'NOT_FOUND'));
};
