const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./shared/utils/logger');
const notFound = require('./shared/middleware/notFound');
const errorHandler = require('./shared/middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(pinoHttp({ logger }));

app.use('/api/v1', require('./modules'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;