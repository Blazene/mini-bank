# Day 20: OpenAPI, Swagger UI and setup documentation

Work began after the Days 15–19 verification pass and compressed-request dependency fix.

## Deliverables

- `GET /api/v1/openapi.json`: same-origin OpenAPI 3.0.3 document.
- `GET /api/v1/docs/`: locally served Swagger UI; no CDN dependency or relaxed Helmet
  script policy. Authorization is not persisted across browser reloads.
- `src/modules/docs/openapi.js`: request/response schemas for every existing business
  operation, auth rules, paise units, retry headers, error responses and pagination filters.
- README: installation, secrets, separate test database, migrations, tests, runnable quote
  example, endpoints, admin setup, architecture, policies and honest production limitations.
- `.env.example` now explicitly lists the existing `JWT_EXPIRES_IN` setting.

The docs endpoints are public, but remain under the existing whole-API limiter. Swagger's
Try it out makes real requests; it does not bypass login or roles. Only use demo data.
The document uses relative `/api/v1` server URLs so it works on local or deployed hosts
without hardcoded ports. Request validation still belongs to Zod, not Swagger.

## Testing strategy

Final combined verification: **61 suites, 902 tests passed**, ESLint and
`git diff --check` passed, and `npm audit` reported zero known vulnerabilities. All
instrumented `src/` files reached 100% on the four coverage metrics; overall line coverage
including the operator script was 98.29%. The child-process coverage caveat from Day 19
still applies. No development database migration or automatic commit/push was performed.

The OpenAPI document is checked with `@apidevtools/swagger-parser`. A route inventory test
compares literal router declarations with documented methods/paths so missing or invented
operations fail tests. This intentionally covers the existing literal-router convention;
dynamic route registration would require extending that inventory test.

The current parser includes ESM dependencies. Structural validation runs in a bounded
native Node 22 subprocess to avoid Jest's CommonJS/ESM interop limitation; no global Jest
transformation or production module-format change is needed.

PostgreSQL-backed contract tests execute every business operation and validate its real
JSON response against the published schema using Ajv. They include pending and reviewed
application shapes, masked history, movement responses, audit entries and monitoring
evidence. Representative errors are checked too. Ajv's format checking is disabled here;
the existing runtime/schema tests validate UUIDs, calendar dates and cursor formats.
This is not proof that every possible response or error is documented perfectly.

Documentation tests also check public versus protected operations, required idempotency
headers, Swagger assets and Helmet's same-origin script policy. Generated UI assets live
in dependencies, not copied/vendor files in this repository.

## Run

```sh
npm ci
npm test
npm run lint
npm audit
npm run dev
```

Then open http://localhost:3000/api/v1/docs/ . No Day 20 database migration is required.
Existing loan/monitoring migrations must already be applied to development using
`npm run migrate -- up`. Tests migrate only the test database.

Verification findings and known remaining risks are in `docs/verification-days-15-19.md`.
Next roadmap items are the app Dockerfile/Compose integration and GitHub Actions, then
deployment and polish. Changes remain uncommitted until requested.
