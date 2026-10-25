const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./shared/utils/logger');
const notFound = require('./shared/middleware/notFound');
const errorHandler = require('./shared/middleware/errorHandler');
const env = require('./config/env');
const { apiLimiter } = require('./shared/middleware/rateLimit');
const corsOptions = require('./shared/middleware/corsOptions');

const app = express();

// Behind a proxy every request seems to come from the proxy. Set TRUST_PROXY to the number
// of proxies so the real client IP is used. Never set it to true: a client could then
// fake its IP with a header and dodge every limit.
app.set('trust proxy', env.TRUST_PROXY);

app.use(helmet());
app.use(cors(corsOptions(env)));
// Before the body parser, so a flood is refused before any body is read.
app.use('/api/v1', apiLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(pinoHttp({ logger }));

app.use('/api/v1', require('./modules'));
require('./shared/middleware/frontend')(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
