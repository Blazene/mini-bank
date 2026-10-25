# Keep native bcrypt dependencies on Linux; never copy the host's node_modules.
FROM node:26-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Build and typecheck the browser client separately. Only dist enters runtime.
FROM node:26-bookworm-slim AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts frontend/playwright.config.ts ./
COPY frontend/src ./src
COPY frontend/e2e ./e2e
COPY frontend/public ./public
# Public same-origin configuration only; never consume backend/cloud secrets here.
ENV VITE_API_BASE=/api/v1
RUN npm run build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 NPM_CONFIG_CACHE=/tmp/npm
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts/make-admin.js ./scripts/make-admin.js
COPY scripts/start-render.sh ./scripts/start-render.sh
COPY db/migrations ./db/migrations
COPY --from=frontend /web/dist ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health', { signal: AbortSignal.timeout(3000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "src/server.js"]
