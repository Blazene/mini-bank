const router = require('express').Router();
const swaggerUi = require('swagger-ui-express');
const spec = require('./openapi');

router.get('/openapi.json', (_req, res) => res.status(200).json(spec));
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: 'Mini Bank API',
    swaggerOptions: { persistAuthorization: false },
  })
);

module.exports = router;
