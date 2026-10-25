# Mini Digital Banking API

An educational Node.js / Express 5 / PostgreSQL banking API with atomic fund transfers,
idempotent writes, transaction history, loan quotes and admin review, audit logging, and
rule-based monitoring. **Not a production banking system; no real payment rails or loan
disbursement.** All money is represented as whole **paise**, never decimal rupees.

## Features

- Registration/login with bcrypt, expiring HS256 JWTs and role guards.
- Owner-scoped savings/current accounts; deposits, withdrawals and transfers.
- Atomic balance/ledger writes, fixed-order row locking and safe retry keys.
- Filtered transaction history with microsecond-safe keyset pagination.
- Exact loan EMI/amortization, indicative eligibility, pending applications and admin review.
- Append-only request audit logs and an operator-only admin-grant command.
- Transactional large-movement and rapid-transfer alerts, readable only by admins.
- Automated unit, PostgreSQL integration, concurrency, live HTTP and OpenAPI contract tests.
- A 95% global coverage gate on statements, branches, functions and lines.

## Run locally

Use Node.js 22, npm, Docker with Compose, and PostgreSQL 16. The application currently
runs on the host; Compose starts **PostgreSQL only**. An app Dockerfile and CI/deployment
are still upcoming work.

```sh
git clone https://github.com/Blazene/mini-bank.git
cd mini-bank
npm ci
docker compose up -d
```

Create `.env` from `.env.example` **only if you do not already have one**. Keep `.env`
untracked. Generate a secret with `openssl rand -hex 32` and replace `JWT_SECRET` in
`.env` with that output before starting the API. Do not use the placeholder in production.

```sh
npm run migrate -- up
npm run dev
```

Default API: **http://localhost:3000/api/v1**

- Swagger UI: **http://localhost:3000/api/v1/docs/**
- OpenAPI JSON: **http://localhost:3000/api/v1/openapi.json**
- Health: **http://localhost:3000/api/v1/health**

Swagger's **Try it out** sends real requests to this server and can change demo balances.
Use disposable data. Authorize with the access token returned by login; token persistence
across page reloads is disabled. Documentation is public, but protected operations still
enforce their normal authentication and authorization.

### Test database and tests

On first setup, create the separate test database (skip this command if it already exists):

```sh
docker compose exec db createdb -U bank minibank_test
npm test
npm run lint
```

The API server does **not** need to be running for tests; PostgreSQL does. `npm test`
applies test migrations, runs suites serially and enforces the coverage gate. The committed
`.env.test` contains deliberately non-production local credentials. Test resets refuse
database names not ending in `_test`; never point tests at valuable data.

`migrate:test` currently uses the default local `bank`/`minibank_test` connection from the
npm script. If you customize database credentials, update that script and `.env.test`
consistently. Changing `.env.test` alone does not change the migration command.

```sh
npm run test:coverage       # alias for npm test, including migrations
open coverage/index.html   # macOS; elsewhere open this HTML file in your browser
npm audit
```

Reports are generated locally under ignored `coverage/`. They include the operator script;
its child-process smoke tests do not merge into Jest's in-process coverage figures. See
[`docs/day-19.md`](docs/day-19.md) for the measurement scope and caveats. High coverage is
not proof of correctness or a security certification.

## Try a read-only loan quote

With the API running, in a second terminal:

```sh
API=http://localhost:3000/api/v1
EMAIL="demo$(date +%s)@example.com"
curl --fail-with-body -sS "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"fullName\":\"Demo User\",\"password\":\"demo1234\"}"
TOKEN=$(curl --fail-with-body -sS "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"demo1234\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).token')
curl --fail-with-body -sS "$API/loans/quote" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"principal":10000000,"tenureMonths":12,"monthlyIncome":5000000}'
```

This quotes Rs 1 lakh over 12 months at 12% nominal annual interest, with an EMI of
**888488 paise (Rs 8,884.88)**. It neither saves an application nor moves money.

## API overview

All paths below start with `/api/v1`. Swagger contains request/response schemas and filters.

| Method    | Path                                                                        | Access / purpose                                 |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| GET       | `/health`                                                                   | Public application/database check                |
| POST      | `/auth/register`, `/auth/login`                                             | Public registration/login                        |
| GET       | `/auth/me`                                                                  | Authenticated current user                       |
| POST, GET | `/accounts`                                                                 | Create/list your accounts                        |
| GET       | `/accounts/:id`                                                             | Your account only                                |
| POST      | `/transactions/deposit`, `/transactions/withdraw`, `/transactions/transfer` | Owner-controlled money movements; key required   |
| GET       | `/transactions`, `/accounts/:id/transactions`                               | Your transaction history                         |
| POST      | `/loans/quote`                                                              | Authenticated read-only calculation              |
| POST      | `/loans/applications`                                                       | Eligible pending application; key required       |
| GET       | `/loans/applications/:id`                                                   | Your application and its customer-visible review |
| GET       | `/admin/loan-applications/:id`                                              | Admin inspection                                 |
| POST      | `/admin/loan-applications/:id/review`                                       | Admin approval/rejection, never self-review      |
| GET       | `/admin/audit-logs`                                                         | Admin request audit log                          |
| GET       | `/admin/alerts`, `/admin/alerts/:id`                                        | Admin monitoring alerts                          |

### Money and retry semantics

- **100 paise = Rs 1.** Send integer JSON numbers, not strings or fractional amounts.
- Send a client-generated `Idempotency-Key` (8–100 allowed characters; a UUID works) on
  deposits, withdrawals, transfers and loan applications. Reuse it only for the same input.
- A replay includes `Idempotent-Replayed: true`; changed input with the same key is refused.
  Money keys are scoped to the initiating account; application keys to the user.
- The original ledger transaction/saved quote is stable, but a money replay returns the
  **current account state**, and an application replay returns its **current review status**.
- Reviews use natural idempotency: the same reviewer, decision and trimmed reason replay;
  a completed decision cannot be edited or reversed through the API.
- Ownership failures use the same 404 as a missing resource. History hides other users'
  account ids and masks counterparty numbers.

### Loan and monitoring policies

Loan quotes use a fixed 12% annual nominal rate, Rs 1,000–10 lakh principal and 6–360
months. Minimum declared income is Rs 15,000/month; existing EMI plus the largest proposed
installment must not exceed 40% of income. Interest/EMI round half-up to paise and the
final installment settles rounding. Income and debt are **not independently verified**.

Applications start pending; admins may approve/reject with a **customer-visible** reason.
Approval is not funding, and multiple applications do not enforce aggregate debt limits.
There are no repayments, outstanding-loan balances, interest accrual or collections.

Monitoring flags movements of at least Rs 1 lakh and the fifth/subsequent outgoing
transfers within five minutes. Alerts are demo heuristics, not proof of fraud. Alerts,
balances and ledger writes commit atomically: monitoring failure rolls back the movement.

## Configuration

| Variable             | Meaning                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection; development and tests must be separate                         |
| `JWT_SECRET`         | At least 32 characters; generate a private random value                               |
| `JWT_EXPIRES_IN`     | Token lifetime, default `1h`                                                          |
| `BCRYPT_ROUNDS`      | Password work factor, 4–15; development example uses 12                               |
| `PORT`               | API port, default 3000                                                                |
| `RATE_LIMIT_ENABLED` | Literal `true`/`false`, default true; test config disables it                         |
| `TRUST_PROXY`        | Number of trusted proxy hops, default 0; configure for the actual deployment topology |
| `NODE_ENV`           | `development`, `test` or `production`; test selects `.env.test`                       |

Make an **existing** user an admin using server/operator access:

```sh
npm run make-admin -- someone@example.com
```

They must log in again to receive an admin JWT. No API endpoint grants roles. Do not
share development database credentials, secrets or operator shell access.

## Architecture and decisions

This is a modular monolith: **routes → validation → controllers → services → repositories**.
Only repositories issue SQL; the owning module accesses its tables. PostgreSQL stores
balances as `BIGINT` paise, with nonnegative-balance and ledger-shape constraints.
Money movements use one transaction/connection and lock account rows in fixed id order.

- [`docs/architecture.md`](docs/architecture.md): schema diagram.
- [`docs/loan-design-decisions.md`](docs/loan-design-decisions.md): Days 15–17 decisions, trade-offs and failure modes.
- [`docs/day-18.md`](docs/day-18.md): monitoring rules, atomicity and limitations.
- [`docs/day-19.md`](docs/day-19.md): coverage strategy and tests.
- [`docs/verification-days-15-19.md`](docs/verification-days-15-19.md): verification findings and dependency fix.

## Security and remaining limitations

JWT algorithm pinning, bcrypt, Zod validation, parameterized SQL, Helmet, a 10 KB JSON body
limit, ownership checks, rate limits and admin guards provide layered defenses. They do
not make this a production-ready bank. Do not expose this demo to real customer data.

- Audit writes happen after responses and can be lost on a crash. The audit-list route
  trusts the token role until expiry; loan-review and alert endpoints recheck the database.
- Rate limits are in-memory and are not shared between processes. CORS is currently open;
  production needs an explicit origin/proxy/TLS/secrets configuration.
- No refresh tokens, reset/verification email, aggregate loan exposure control or durable
  audit delivery. Admin grant and its audit write are separate statements.
- Alert evidence is not protected by the audit table's append-only trigger. Thresholds
  are educational, with no historical backfill or notification/resolution workflow.
- Swagger describes the contract but does not replace runtime validation. Tests include
  schema checks against every business operation's actual PostgreSQL-backed response.
- Dependency audits are point-in-time checks, not guarantees against unknown vulnerabilities.

Next roadmap items: app Dockerfile/Compose integration, GitHub Actions, deployment,
production configuration review and final demonstration/polish. A frontend is optional.
