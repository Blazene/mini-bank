# Mini Digital Banking API

[![CI](https://github.com/Blazene/mini-bank/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Blazene/mini-bank/actions/workflows/ci.yml)

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

Choose either **Node on your host** or the **full Docker stack** below. Both use PostgreSQL
16 and the same migrations. Docker Desktop (or Docker Engine with Compose) must be running.
The API container uses Node.js 22; the host workflow needs Node.js 22 and npm installed.

### Option A: Node on the host

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

Plain `docker compose up -d` still starts only PostgreSQL. The opt-in `app` profile below
is not enabled, so this workflow does not unexpectedly occupy the API port.

### Option B: full Docker stack

Create `.env` from `.env.example` if missing and replace `JWT_SECRET` with a fresh
`openssl rand -hex 32` value. No host `npm install` is needed for this option.

```sh
docker compose --profile app up --build -d --wait
docker compose --profile app ps -a
docker compose --profile app logs --tail=50 api migrate
```

Compose waits for PostgreSQL health, runs the one-off **migrate** job, then starts the
API only if migration succeeds. The migration container exiting with code 0 is expected.
The API runs non-root with a read-only filesystem, dropped capabilities and a bounded
temporary filesystem. Native bcrypt dependencies are installed inside Linux, not copied
from your Mac. Secrets, test code, `.git`, host dependencies and coverage reports are not
included in the runtime image.

Stop a host `npm run dev` before using Docker's default port 3000, or choose another port:

```sh
API_PORT=3001 docker compose --profile app up --build -d --wait
```

`API_PORT` changes the host-facing API port; the container always listens on 3000. Similarly,
`DB_PORT` can change the host-facing database port, while containers use `db:5432` on their
private Compose network. The host `.env` `DATABASE_URL` remains valid for host commands;
Compose overrides it inside the API/migration containers with the service DNS URL.

Both published ports bind to **127.0.0.1**, not every network interface. This is a local
demo setup, not an Internet-ready deployment template. PostgreSQL's local demo credentials
remain `bank` / `bankpass`; changing initialization variables does not rotate existing
database credentials in a persisted volume.

Useful container commands:

```sh
docker compose exec -T api npm run make-admin -- someone@example.com
docker compose --profile app run --rm migrate
docker compose --profile app down
```

`down` stops/removes containers and the network but **retains `pgdata`**. Do not add
`--volumes` / `-v` to your normal project unless you deliberately intend to delete its
database. Do not start host and container instances against this database simultaneously
when relying on single-process rate limits.

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

For the separate, opt-in Docker verification (requires a running Docker daemon):

```sh
npm ci
npm run test:docker
```

It builds a unique image, uses random localhost ports and an isolated Compose project/
database volume, verifies API behavior and persistence across container recreation, then
removes **only its own** resources. It does not reset or delete your normal development
database. The first run downloads the base image/dependencies. Standard `npm test` also
checks Docker configuration but does not build images or require Docker CLI itself.

### Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, or a manual Actions run:

1. **Tests, lint and coverage** — Ubuntu 24.04, Node 22, a health-checked PostgreSQL 16
   service pre-created as `minibank_test`, `npm ci`, lint, migrations/full tests/coverage,
   and `npm audit --audit-level=high`.
2. **Docker stack verification** — after the first job passes, builds and tests the full
   isolated stack with `npm run test:docker`, including persistence and production log privacy.

Coverage reports are uploaded as a seven-day `coverage-node22` artifact, including after
test failure when a report exists. The workflow uses read-only permissions and SHA-pinned
official actions, needs no repository/production secrets, and does not publish or deploy.
Weekly Dependabot checks cover npm, GitHub Actions pins and Docker base images; updates
still require review and passing CI, not automatic merging.

The badge reflects **hosted runs**, not local test results. Both jobs passed for Day 22
commit `47949cc` ([hosted run](https://github.com/Blazene/mini-bank/actions/runs/40187980401));
check each later commit in the [Actions tab](https://github.com/Blazene/mini-bank/actions).
Repository administrators may separately require both job checks in branch
protection/rulesets; this configuration does not enable those settings automatically.

Reports are generated locally under ignored `coverage/`. They include the operator script;
its child-process smoke tests do not merge into Jest's in-process coverage figures. See
[`docs/day-19.md`](docs/day-19.md) for the measurement scope and caveats. High coverage is
not proof of correctness or a security certification.

## Deploy a free demo: Render + Neon

**Live demo:** [Swagger UI](https://mini-bank-api-2bxt.onrender.com/api/v1/docs/) ·
[health](https://mini-bank-api-2bxt.onrender.com/api/v1/health) ·
[OpenAPI](https://mini-bank-api-2bxt.onrender.com/api/v1/openapi.json).
Deployed and smoke-tested on 25 October 2026 from `5eb216e`.
[`docs/day-23.md`](docs/day-23.md) records the setup, verification and free-tier limits.

1. Push this configuration and confirm CI is green on the commit to deploy.
2. Create a separate **Neon Free** PostgreSQL 16 project, preferably in AWS Singapore.
   Leave optional Neon services disabled. In Connect, turn **connection pooling off**.
3. In the direct connection URL, replace `sslmode=require` with `sslmode=verify-full`.
   Keep the URL private; do not paste it in chat, Git, issues, screenshots or logs.
4. In Render, create a **Blueprint** from this repository's `main` branch and `render.yaml`.
   Confirm **Free**, Singapore and one API instance; paste the URL directly into the
   prompted `DATABASE_URL` secret. Render generates `JWT_SECRET`. Do not add a Render
   database, paid disk, extra instance, card or plan upgrade for this demo.
5. After a successful deploy, verify HTTPS `/api/v1/health`, `/api/v1/docs/` and the
   disposable auth/account/money checks in the runbook. Keep tokens and credentials private.

Render runs `/bin/sh scripts/start-render.sh`: validate environment/direct Neon TLS,
apply migrations, then `exec node src/server.js`. A validation or migration failure
prevents HTTP startup. The normal Docker/Compose start path is unchanged. Automatic
deploys use `checksPass`; GitHub must be connected with access to CI check results.

Production defaults to **no cross-origin browser permission**; same-origin Swagger and
non-browser API clients still work. Set `CORS_ORIGINS` in Render only for specific frontend
origins, for example `https://frontend.example` (no trailing slash or wildcard). CORS is
not authentication or a firewall. `TRUST_PROXY=1` assumes Render's single trusted proxy;
recheck that assumption if adding another proxy/CDN.

Free services have quotas and cold starts: Render sleeps after 15 idle minutes, and Neon
can suspend idle compute. Render's free Postgres expires after 30 days, so it is deliberately
not used. Neither provider's free tier is suitable for real banking data or an uptime SLA.

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

| Variable                   | Meaning                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL connection; development and tests must be separate                               |
| `JWT_SECRET`               | At least 32 characters; generate a private random value                                     |
| `JWT_EXPIRES_IN`           | Token lifetime, default `1h`                                                                |
| `BCRYPT_ROUNDS`            | Password work factor, 4–15; development example uses 12                                     |
| `PORT`                     | API port, default 3000                                                                      |
| `RATE_LIMIT_ENABLED`       | Literal `true`/`false`, default true; test config disables it                               |
| `TRUST_PROXY`              | Number of trusted proxy hops, default 0; configure for the actual deployment topology       |
| `NODE_ENV`                 | `development`, `test` or `production`; test selects `.env.test`                             |
| `CORS_ORIGINS`             | Comma-separated exact HTTP(S) origins; empty denies CORS in production, permits `*` locally |
| `DB_POOL_MAX`              | Maximum connections per process, 1–20; default 10, Render uses 5                            |
| `DB_CONNECTION_TIMEOUT_MS` | Connection acquisition timeout, 1000–60000 ms; default 10000                                |

Compose-only optional settings: `API_PORT` (default 3000), `DB_PORT` (default 5432), and
`APP_IMAGE` (default `mini-bank-api:local`). Container `NODE_ENV` is always `production`;
its JWT/work-factor/rate-limit/proxy settings are passed explicitly from the environment
or `.env`. A missing/short JWT secret fails application startup; there is no image default.

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
- [`docs/day-21.md`](docs/day-21.md): container design, isolated verification and log redaction.
- [`docs/day-22.md`](docs/day-22.md): GitHub Actions jobs, supply-chain controls and verification scope.
- [`docs/day-23.md`](docs/day-23.md): free Render/Neon deployment, private configuration and live verification checklist.

## Security and remaining limitations

JWT algorithm pinning, bcrypt, Zod validation, parameterized SQL, Helmet, a 10 KB JSON body
limit, ownership checks, rate limits and admin guards provide layered defenses. They do
not make this a production-ready bank. Do not expose this demo to real customer data.

- Audit writes happen after responses and can be lost on a crash (graceful shutdown drains
  pending writes). The audit-list route
  trusts the token role until expiry; loan-review and alert endpoints recheck the database.
- Rate limits are in-memory, reset on restart and are not shared between processes. Keep
  one API instance; overlapping deploys can briefly have independent limits. Production
  CORS is closed by default; proxy/TLS/secrets still require correct provider configuration.
- No refresh tokens, reset/verification email, aggregate loan exposure control or durable
  audit delivery. Admin grant and its audit write are separate statements.
- Alert evidence is not protected by the audit table's append-only trigger. Thresholds
  are educational, with no historical backfill or notification/resolution workflow.
- Swagger describes the contract but does not replace runtime validation. Tests include
  schema checks against every business operation's actual PostgreSQL-backed response.
- Dependency audits are point-in-time checks, not guarantees against unknown vulnerabilities.
- HTTP Authorization/Cookie headers and response Set-Cookie values are redacted from
  production logs. This is not a blanket guarantee that arbitrary future log messages
  cannot contain sensitive data.

Next roadmap items: final configuration review and demonstration/polish. A frontend is optional.
