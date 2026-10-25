# Day 23: free Render + Neon deployment

## Status

**Locally verified deployment configuration; live deployment pending.** No public API URL
has been verified. Day 23 changes are not yet committed/pushed. The user selected Render
Free for the API and Neon Free for PostgreSQL; no paid resource is approved. Both provider
dashboards are signed in. An unrelated existing Neon project must not be reused or changed.

Day 22's hosted CI is confirmed green for `47949cc`:
[both jobs passed](https://github.com/Blazene/mini-bank/actions/runs/40187980401).
That result does not verify these new deployment changes.

## What changed

- `render.yaml`: one Singapore **Free** Docker web service, `main`, port 10000, database
  health check, CI-gated automatic deploys, generated JWT secret and privately prompted DB URL.
- `scripts/start-render.sh`: validates configuration, rejects pooled Neon connections and
  missing/weaker Neon TLS modes, runs migrations, then replaces the shell with Node.
  URL validation errors print only their message, not credential-bearing input fields.
- Dockerfile/build allowlist include the bootstrap. Docker's default Node command and
  Compose's separate migration job remain unchanged.
- Production CORS is closed by default. Exact optional frontend origins are validated;
  test/development retain the prior permissive default. Credentials/cookies are not enabled.
- Configurable PostgreSQL pool size (Render: 5) and connection acquisition timeout (10 s).
  Idle-client errors are handled/logged instead of becoming unhandled emitter errors when
  managed PostgreSQL disconnects idle clients. This does not retry failed transactions.
- Graceful shutdown closes HTTP, drains pending audit writes, then ends the DB pool.
  Duplicate signals are ignored and cleanup failures exit nonzero. Hard termination can
  still lose audit writes; the provider's termination deadline still applies.

No new dependencies, banking behavior, database migrations, deploy hook tokens or
production credentials were added. Existing production dependencies include the migrator.

## 1. Publish only after checks pass

Commit/push Day 23 when authorized, and check both GitHub CI jobs for that exact commit.
Render cannot build files that exist only on a developer's machine. Do not merge the
separate unverified Node 26 Dependabot proposal as part of deployment.

## 2. Create a separate Neon Free project

1. In [Neon Console](https://console.neon.tech/), confirm the organization is on **Free**.
   Create a new `mini-bank` project, not a branch/database in an unrelated existing project.
2. Prefer **AWS Singapore** near the Render API, and **PostgreSQL 16** to match local/CI
   verification. Leave object storage, functions, gateway, realtime and Better Auth disabled.
   If the region/version or Free plan is unavailable, stop and review rather than accepting
   a paid alternative automatically.
3. Use its production branch and an empty database (the generated `neondb` is fine).
   The role needs permission to apply migrations, including creating extensions/tables.
4. Open **Connect**, select the branch/database/role and turn **Connection pooling off**.
   Use the direct hostname, **without `-pooler`**. Startup migrations use session advisory
   locks; transaction-mode poolers do not preserve their session ownership correctly.
5. Replace `sslmode=require` in the private URL with **`sslmode=verify-full`**. This explicitly
   enables certificate/hostname validation in node-postgres. Preserve URL-encoded credentials.
   Do not use `rejectUnauthorized: false`, `sslmode=no-verify` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.
6. Paste the URL **directly into Render's secret field** below. Never commit it, put it in
   chat, or run a shell command with the real URL where it will be recorded in history.

Do not turn on Neon Data API/extra authentication; this app already provides its own JWT
authentication. No local `.env` or test database should be changed to point at cloud data.

## 3. Create the Render Free API

1. In [Render Dashboard](https://dashboard.render.com/), choose **New → Blueprint**.
   Connect GitHub and authorize only the repository access needed for `Blazene/mini-bank`.
   Use `main` and the root `render.yaml` path.
2. Review the resource plan before applying: only `mini-bank-api`, type web/Docker, **Free**,
   Singapore, one instance, no disk, no Render database, no paid background/pre-deploy job.
3. Enter the private Neon direct URL as `DATABASE_URL` when prompted. Render generates a
   256-bit `JWT_SECRET`; do not replace it with a committed test/example secret. Keep both
   out of screenshots and logs. A JWT secret rotation invalidates existing tokens.
4. Apply/deploy. If asked for payment, a card or a plan upgrade, stop; paid service is not
   authorized. Do not create an additional database on Render.
5. Confirm the service uses `/bin/sh scripts/start-render.sh`, port **10000** and health
   path **`/api/v1/health`**. `TRUST_PROXY=1` is for Render's edge proxy; do not use `true`.
6. Check deployment logs for migrations completing, then the API port readiness message.
   A bad configuration/migration must prevent startup, not leave an unmigrated server live.
7. Record the actual assigned HTTPS URL and deployed Git commit only after successful checks.

The Blueprint sets `autoDeployTrigger: checksPass`. Connect the GitHub provider so Render
can see CI status; confirm that setting in the dashboard. Initial/manual deploys still need
operator review of the selected commit. The GitHub workflow itself holds no cloud secrets
and does not call deploy hooks.

Render Free has no pre-deploy command/one-off jobs/shell access, hence startup migrations.
Migrations do **not** run during image build and no DB secret is baked into the image.
Every restart checks migrations; applied ones are skipped. Use backward-compatible future
migrations because old/new processes can overlap during a rollout. Rolling back code does
not automatically roll back database schema/data; never blindly run `migrate down` on a
deployed database.

### Optional frontend CORS

Leave `CORS_ORIGINS` unset for same-origin Swagger and curl/Postman. For a separate frontend,
set exact comma-separated origins in Render, e.g. `https://frontend.example,http://localhost:5173`.
No trailing slash, wildcard, path, query, or credentials. Allowed preflight can use bearer
Authorization and Idempotency-Key; retry/rate-limit headers are exposed to the frontend.
Disallowed origins receive no CORS permission, not a server-side access denial. CORS does
not stop non-browser clients or replace authentication, ownership checks or rate limits.

## 4. Live smoke-check checklist (not yet executed)

Use the actual assigned host, not an assumed `mini-bank-api.onrender.com` URL. Cold starts
can take a minute; allow a generous timeout for the initial request.

```sh
BASE=https://YOUR-ACTUAL-SERVICE.onrender.com
curl --fail-with-body --max-time 120 "$BASE/api/v1/health"
curl --fail-with-body --max-time 120 "$BASE/api/v1/openapi.json"
```

- Health: HTTPS 200 with `{"status":"ok","database":"up"}`. Check HTTP redirects to HTTPS.
- Open `/api/v1/docs/` in the browser; UI assets load, OpenAPI uses relative `/api/v1`,
  and Try it out stays on the hosted origin. `/api/v1/openapi.json` returns OpenAPI 3.0.3.
- An unauthenticated `GET /api/v1/accounts` returns 401, not data or a server error.
- Use fresh disposable accounts, fake email/password values and fake money only. Register,
  log in, create an account, deposit integer paise using a fresh idempotency key, replay
  it with the same key, and verify the balance/ledger changed only once. Verify a second
  user cannot read the first user's account. Do not print JWTs/passwords in the report.
- Submit the README's read-only quote input; expected EMI is **888488 paise**. A customer
  must still receive 403 on an admin-only endpoint. No public admin-grant API is added.
- Check an arbitrary Origin receives no `Access-Control-Allow-Origin` by default. If a
  frontend is configured, check its allowed preflight and an unlisted origin separately.
- Inspect logs/settings for proxy/rate-limit configuration warnings and errors; do not
  paste secrets or raw auth headers into an issue. Check the app sees distinct client IPs
  correctly before relying on per-client limits. Avoid intentionally flooding a free service.
- Redeploy/restart using the supported dashboard action. Verify existing disposable data
  persists and migration logs say no migrations remain. Recheck health after idle wake-up.

Admin setup is optional for the public smoke test. Render Free has no shell: a trusted
operator can instead run `npm run make-admin -- disposable-reviewer@example.com` locally
using a **temporary private environment** pointing at the cloud DB. Do not change the
normal development/test `.env` or paste its URL into shell history. The command grants
privilege and records an audit entry; run it only deliberately, and log in again afterward.
Never expose a temporary HTTP admin/setup route to work around the missing shell.

## Local verification

Verified before publishing:

- **69 suites, 971 tests passed**, including environment bounds/origin validation, real
  CORS middleware, pool options/error handling, audit-drain/shutdown ordering, Blueprint
  free/security settings and child-process startup success/failure ordering.
- Global coverage: statements **98.46%**, branches **98.67%**, functions **98.36%**, lines
  **98.32%**; all four 95% gates pass. Shell bootstrap child-process tests are outside
  Jest's JavaScript coverage accounting.
- `npm run lint` passed; `npm audit --audit-level=high` reported **zero known vulnerabilities**.
- `render.yaml` validated against Render's official current JSON schema with existing Ajv.
  Schema validation alone cannot prove plan/region availability or account permissions.
- `npm run test:docker` passed. It builds a fresh isolated image, executes the actual Render
  bootstrap against a separate fresh database at container port 10000, verifies all five
  migrations, production CORS, repeated startup with no pending migrations and clean SIGTERM
  exit. Existing auth/money/loan/monitoring/redaction/persistence checks also pass. It removes
  only its own randomly named project/image/volume/containers, not the developer's database.

Local PostgreSQL/Docker checks do **not** validate Neon certificate connectivity, public
HTTPS, Render startup limits, GitHub authorization, provider quotas or cloud persistence.
Complete and record the live checklist before marking Day 23 deployment complete.

## Free-tier and operational limits

- Render Free sleeps after 15 idle minutes, has monthly usage/build/bandwidth limits and
  an ephemeral filesystem. Keep data in Neon, not local files. No guaranteed uptime.
- Render Free Postgres expires after 30 days; it is intentionally not provisioned here.
- Neon Free has storage/compute/network limits and scale-to-zero cold starts. Review current
  quotas in its dashboard; do not upgrade automatically or create valuable real data.
- Render's regular database health probes may keep Neon compute active while the API is
  awake. Health fails when the database is unavailable and may trigger service restarts.
- Rate limits are per process, reset on wake/redeploy and briefly independent during
  overlapping deployments. Multi-instance scaling requires a shared limiter store first.
- No production banking/PII, backups/SLA guarantee, email recovery, durable audit delivery,
  refresh-token/session revocation system, real payment rails or actual loan disbursement.
- On startup failure, correct private configuration/migration permissions and redeploy;
  do not disable TLS, skip locks/migrations, or post a connection string publicly to debug.
- Keep dependency review and the existing CI gate active. A successful smoke check is not
  a security audit, load test or guarantee of future free-tier availability.

References checked: [Render Free](https://render.com/docs/free),
[Blueprint spec](https://render.com/docs/blueprint-spec),
[deploy lifecycle](https://render.com/docs/deploys),
[Neon connections](https://neon.com/docs/connect/connect-from-any-app),
[Neon pricing](https://neon.com/pricing).
