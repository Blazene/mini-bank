const router = require('express').Router();
const db = require('../../config/db');

router.get('/', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'up' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
