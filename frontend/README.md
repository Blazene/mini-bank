# Mini Bank web

React + TypeScript + Vite. See [`../docs/frontend.md`](../docs/frontend.md) for scope,
security boundaries, testing and same-service deployment details.

**Public website:** https://mini-bank-api-2bxt.onrender.com/ ·
[sample-data preview](https://mini-bank-api-2bxt.onrender.com/demo/overview).
See [deployment verification](../docs/frontend-deployment.md).

```sh
npm ci
npm run dev
```

- Preview (sample data, no API calls): http://127.0.0.1:5173/demo/overview
- Live API-backed sign-in: http://127.0.0.1:5173/login

The local proxy defaults to the hosted educational API; live-mode writes persist there.
Use disposable information only. To use a local backend:

```sh
API_PROXY_TARGET=http://127.0.0.1:3000 npm run dev
```

Tokens stay in memory. No database/JWT/cloud secrets belong in this package.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests run on 5174 with a mocked API and do not touch hosted data. Docker builds
this client into the existing Render service using same-origin `/api/v1`; the Vite proxy
works only during local development. No separate static host or production CORS change is needed.
