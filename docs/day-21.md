# Day 21: Docker image and full Compose stack

## Scope

The API now has a runnable Linux image, alongside PostgreSQL 16 and a one-off migration
job. This is local development/demo packaging, not a production deployment or a claim
that a container solves existing application limitations. No database migration was added.

## Design decisions and trade-offs

| Decision                                                           | Benefit / trade-off / failure mode                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 22 Debian slim, separate dependency/runtime stages            | Uses glibc-compatible native bcrypt on Linux. `npm ci --omit=dev` respects the lockfile; the runtime has no Jest/nodemon/ESLint or build cache. The base tag can move, so builds are not bit-for-bit reproducible without digest pinning.                       |
| Allowlisted build context and explicit COPY                        | `.env*`, `.git`, host node_modules, tests and coverage do not enter the runtime. New runtime files outside included paths require updating the allowlist/COPY statements. No secret build arguments or baked-in database/token secrets.                         |
| Direct `node src/server.js` command under `USER node`              | Avoids npm/shell signal forwarding for the API and root execution. Compose's init process forwards signals/reaps child processes. Operator/migration npm commands remain available because node-pg-migrate is a production dependency.                          |
| Read-only root filesystem, dropped capabilities, no-new-privileges | Reduces writable/privileged surface. `/tmp` is a bounded writable tmpfs; npm cache goes there. Future runtime file uploads/log files would need deliberate storage, not writes into the application tree.                                                       |
| Opt-in `app` profile                                               | Plain `docker compose up -d` remains the original DB-only host workflow. Full stack needs `--profile app`; this avoids surprise API port collisions.                                                                                                            |
| Healthy DB -> migration exit 0 -> API                              | A fresh stack gets schema before serving. Migration failure blocks the API. Migration is a separate local operator job, not hidden in every Node restart. New code/migrations require rebuilding and bringing the stack up, not merely restarting an old image. |
| Internal `db:5432` URL overrides the host URL                      | Container localhost is not your Mac or the other container. Host commands can keep localhost in `.env`; using that host URL inside the container breaks DB access.                                                                                              |
| Existing `pgdata` volume name preserved                            | Existing development data is retained; default down does not delete it. Initialization credentials only apply to an empty Postgres volume, not password rotation on existing data.                                                                              |
| Localhost-only published ports; optional API_PORT/DB_PORT          | Reduces accidental LAN exposure and allows isolated tests. Remote deployment needs deliberate TLS/proxy/network settings. Container API PORT is fixed at 3000; host PORT from `.env` does not control the published container port.                             |
| Runtime secrets only, no default JWT secret                        | Missing/short secret fails through the existing Zod config. DB-only profile does not require JWT configuration. The long `.env.example` placeholder must still be replaced; length validation alone does not make it secret.                                    |
| Image HTTP healthcheck uses Node fetch                             | No curl package needed. Bounded timeout checks the real health route/database. It is not a full business-flow probe; successful initial migrations are checked separately.                                                                                      |

## Security finding fixed during packaging

A production-mode logging probe found that pino-http's default request serialization
included **Authorization and Cookie headers**. Test-mode logging had been silent, so
the existing test suite did not expose this credential leakage. The probe used fake
credentials, not real user tokens.

`src/shared/utils/logger.js` now redacts `req.headers.authorization`, `req.headers.cookie`
and `res.headers["set-cookie"]`. A real Pino serialization test checks that secrets disappear
while status/user-agent diagnostics remain. Docker verification also checks actual
production HTTP logs after bearer-authenticated and cookie-bearing requests. No other
banking rules changed. Future logging changes still require their own privacy review.

## Commands

Host workflow remains:

```sh
docker compose up -d
npm run migrate -- up
npm run dev
```

Full stack (set a real random JWT_SECRET in `.env` first):

```sh
docker compose --profile app up --build -d --wait
docker compose --profile app ps -a
docker compose --profile app logs --tail=50 api migrate
```

Swagger stays at http://localhost:3000/api/v1/docs/ unless API_PORT is changed.
The migration service normally exits with code 0. API and DB should become healthy.
To stop while retaining data: `docker compose --profile app down`. Do not use `-v` on
the normal project unless deliberately deleting its data.

## Verification

Verified on this Mac with Docker Desktop's **Linux/ARM64** engine:

- **63 Jest suites, 909 tests passed** (7 added since Day 20).
- The Docker build/full-stack verification passed, including a repeat run with cleanup
  checks and an explicit guard against shared/external volumes or host bind mounts.
- ESLint and `git diff --check` passed; `npm audit` reported zero known vulnerabilities.
- Overall JavaScript line coverage remained **98.29%** including the operator script;
  the Docker smoke script is a separate opt-in check, not part of Jest coverage.
- No new migration or normal development data reset was performed. Linux/AMD64 and an
  external deployment were not tested.

```sh
npm test
npm run lint
npm audit
npm run test:docker
```

The regular Jest suite checks configuration and log serialization without requiring Docker
CLI. `yaml` is an explicit dev-only dependency for parsing Compose configuration.
The Docker smoke check is separate (`tests/docker/verify.js`), not secretly run by Jest.

The opt-in script creates a fresh random project/image name and localhost ports, ignores
the user's `.env` for its isolated settings, and supplies a generated ephemeral JWT secret.
It checks the resolved volume name before starting or cleaning up anything and refuses
shared/external volumes and host bind mounts.
It verifies:

- Default Compose services remain DB-only.
- A Linux image builds with usable native bcrypt and no test tools, environment files,
  source tests, Git directory or coverage artifacts.
- Non-root image startup, short-secret refusal and read-only/capability-reduced runtime.
- Fresh migrations succeed before API readiness, and Swagger/OpenAPI are reachable.
- Registration/login, owner-only data, deposit retry safety, five transfers and two alerts.
- Loan quote/application/review, operator admin grant and new-token requirement.
- Exact account/ledger totals and redacted production credentials/cookies in logs.
- Full container recreation without deleting the volume preserves balances and approved
  applications; the next migration job has nothing left to apply.

Cleanup uses `down --volumes` only on the random project owned by that script, then
removes its unique image tag. It never stops, resets or deletes the normal Compose
project/database. Docker build cache/base-image downloads may remain normally.

Known limits remain: audit delivery/shutdown are best-effort, rate counters reset on process
restart, CORS is open, PostgreSQL uses demo credentials, and no image OS-vulnerability scan
or external deployment has been performed. Next is GitHub Actions CI, then deployment
verification and polish. No automatic commit or push is performed.
