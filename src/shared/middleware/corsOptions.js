module.exports = (env) => ({
  origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : env.NODE_ENV === 'production' ? false : '*',
  exposedHeaders: ['Idempotent-Replayed', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
});
