# Day 24 security and deployment review

**Scope:** point-in-time source/configuration review and bounded regression/smoke checks,
25 October 2026. This is **not** an independent penetration test, compliance attestation,
load test or approval to use real funds/personal data. The public deployment remains an
educational demo. Day 24 was subsequently published as `1302383`, with
[green hosted CI](https://github.com/Blazene/mini-bank/actions/runs/40195821465) and a successful Render auto-deploy.

## Findings addressed locally

### Startup URL validation must match what pg connects to

The Day 23 bootstrap used `URLSearchParams.get('sslmode')`, which returns the **first**
value, while node-postgres's connection-string parser iterates into a map, retaining the
**last**. Thus a mistakenly duplicated `sslmode=verify-full&sslmode=no-verify` could pass
our check but weaken the driver's TLS configuration. Similarly, pg supports a `host=`
query override; checking only the URL authority could validate one host and connect to
another. This requires access to private service configuration, not an unauthenticated
HTTP request, but weakens the deployment guardrail.

The bootstrap now rejects host query overrides, requires exactly one Neon `sslmode` set
to `verify-full`, rejects globally disabled TLS verification for Neon, and decodes/normalizes
hostnames before detecting Neon/pooler endpoints. Child-process regressions cover duplicate
mode, host override, uppercase/trailing-dot/encoded pooled hosts and global TLS bypass.
Failures still occur before migrations/HTTP and do not print credential-bearing URL fields.
The valid Render/Compose startup path is preserved. This validation is not a substitute
for correctly protecting Render settings or the underlying driver's certificate checks.

### Ignore private environment variants before frontend work

`.gitignore` previously ignored only `.env`. It now also ignores `.env.*`, including
future `.env.local`, `.env.production` and nested frontend variants. Explicit nonsecret
`.env.example` and local-only `.env.test` remain versionable. This does not remove secrets
already committed or replace review/secret scanning; none were intentionally introduced.

## Control and evidence matrix

| Area                  | Current control / evidence                                                                                                                          | Remaining boundary                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Passwords / JWT       | bcrypt, fixed HS256 verification, expiring JWT, generic login errors; auth tests                                                                    | No refresh/revocation/email recovery; protect signing secret                                                          |
| Ownership / roles     | Owner-scoped account/application reads, 404 concealment; customer admin 403; no HTTP grant route                                                    | Admin audit listing trusts token role until expiry; not all auth state is reloaded on every route                     |
| SQL / money           | Parameterized repositories, nonnegative/check constraints, sorted locks, atomic ledger/balances/monitoring, scoped retry keys; DB/concurrency tests | Simulated deposits, not payment rails or full double-entry accounting                                                 |
| Input / errors        | Zod validation, 10 KB JSON limit, generic 5xx envelope, safe integer paise                                                                          | Availability/query duration is not universally bounded by a statement timeout                                         |
| Browser / edge        | Helmet, HSTS over hosted HTTPS, no X-Powered-By, closed production CORS; live read-only checker passed                                              | Bundled frontend uses the same origin; no new CORS permission is required; CORS is not access control                 |
| Rate limiting / proxy | Enabled per-IP/email/user MemoryStore limits; configured TRUST_PROXY=1                                                                              | Counters reset on restart and are independent during overlaps; independent-client IP isolation was not verified       |
| Logs / audit          | Authorization/Cookie/Set-Cookie redaction, selected metadata, append-only audit trigger; local tests/Docker probes                                  | Audit delivery is post-response/best-effort; arbitrary log text and privileged DB operators remain risks              |
| Database connection   | Direct Neon endpoint, verify-full startup requirement, bounded pool/connect timeout                                                                 | Runtime role also runs migrations and has DDL capability; split migration/runtime privileges before a real deployment |
| Build / secrets       | Lockfile install, production-only dependencies in non-root image, build allowlist; private Render env, no cloud secrets in CI                       | Dependency/image auditing is point-in-time, not proof of safety; review private settings/access regularly             |
| Lifecycle / data      | Migration-before-listen, exec Node, graceful audit drain/pool close; isolated Docker and Day 23 restart/persistence evidence                        | Hard termination, incompatible schema rollback, quotas/sleep and backup/restore guarantees remain unresolved          |
| CI / GitHub access    | Read-only CI token, SHA-pinned official actions, coverage gate; Render app explicitly scoped to mini-bank                                           | Render app has broader write permissions; branch protection/admin policies not enabled by repository code             |

Tests referenced include `tests/integration/{auth.*,accounts,transfer,idempotency,loan.*,audit*,monitoring*,rateLimit,schema}.test.js`,
`src/shared/middleware/__tests__/`, `src/shared/utils/__tests__/logger.test.js`,
`tests/unit/render.startup.test.js`, `scripts/__tests__/verify-demo.test.js` and
`tests/integration/demo.verify.test.js`. The test database helper refuses non-`_test` reset targets.

## Provider checks (read-only)

Render's authenticated settings showed Singapore, Free, `main`, Dockerfile/context as
configured, `/bin/sh scripts/start-render.sh`, `/api/v1/health`, an empty pre-deploy command,
**After CI Checks Pass**, and PR previews **Off**. No private environment values or deploy
hook were printed/revealed to perform this check. Neon remains the separate Free project
created in Day 23; this review did not change cloud roles, secrets, plans or resources.

`npm run verify:demo -- --base-url https://mini-bank-api-2bxt.onrender.com` passed against
the existing deployment, checking health/DB, HSTS/nosniff/framework-header omission,
unlisted-origin CORS, OpenAPI/same-origin server, Swagger HTML and 401 guards. It created
no users/accounts/money/applications. Existing request/audit logs are normal server effects.

The Day 24 deployment `1302383` has [both CI jobs green](https://github.com/Blazene/mini-bank/actions/runs/40195821465).
See [Day 24](day-24.md) for its local results. The later frontend deployment `bf4e142`
passed [all three CI jobs](https://github.com/Blazene/mini-bank/actions/runs/40202387787);
[its deployment report](frontend-deployment.md) separately records public website checks
and bounded disposable writes. No load flood, cloud admin grant, secret rotation, database reset,
plan upgrade, security-setting mutation or production restart was performed in Day 24.

## Dependabot review — no merges

Each open PR's diff, head/base and hosted checks was reviewed separately. Patch PR checks
predate deployment changes, so their old success is not proof against current main.

| PR                                                | Reviewed change / head                                        | Hosted evidence                                                                                               | Decision                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/Blazene/mini-bank/pull/1) | Both Docker stages Node 22 → 26; `cb4901e`                    | [Tests failed; Docker skipped](https://github.com/Blazene/mini-bank/actions/runs/40191498880), base `5eb216e` | Hold. Failure is the explicit Node 22 config assertion, not proven Node 26 runtime incompatibility. Plan an intentional runtime/CI/native-bcrypt upgrade separately. |
| [#2](https://github.com/Blazene/mini-bank/pull/2) | dotenv 18.0.7 → 18.0.8; only manifest/lock entry, `0b0060b`   | [Both jobs passed](https://github.com/Blazene/mini-bank/actions/runs/40188056105), base `47949cc`             | Small patch candidate. Refresh against current main and rerun env/startup/DB/Docker checks, then explicitly approve/merge.                                           |
| [#3](https://github.com/Blazene/mini-bank/pull/3) | ESLint 10.12.0 → 10.13.0; only manifest/lock entry, `8b2f102` | [Both jobs passed](https://github.com/Blazene/mini-bank/actions/runs/40188069289), base `47949cc`             | Dev-only patch candidate. Refresh and rerun lint/full CI before explicit approval.                                                                                   |

No dependency was installed/upgraded, no PR was rebased/commented/approved/merged, and no
remote branch was modified by this review. Diff review/old CI does not constitute a full
audit of upstream package contents or attest future advisory status. Current lockfile
audit results are recorded in Day 24; keep auditing after dependency changes.

## Accepted demo risks and real-production prerequisites

- **Never real banking:** funds can be simulated by customer deposit calls; no real payment
  settlement, double-entry general ledger, KYC/compliance assessment or regulatory AML system.
- No enforceable aggregate debt exposure, repayments, disbursement or independently verified
  income. Monitoring thresholds are heuristics, with no alert-resolution/notification system.
- Expiring access tokens have no centralized logout/revoke mechanism. Audit-list role claims
  can be stale until expiry. Do not call this immediate session revocation.
- Best-effort audits may be lost on crash; operator role update/audit are separate statements.
  Stronger systems need durable transactional delivery and independently protected evidence.
- Separate least-privilege runtime/migration DB roles, verified backup/restore and retention,
  incident response, secret/access rotation, HA, observability and privacy/data minimization
  are prerequisites for valuable data. Free-tier quotas and cold starts are not an SLA.
- A shared rate-limit store and verified forwarding topology are prerequisites for scaling;
  the later frontend uses memory-only tokens/retry intents, React escaping, self-hosted
  assets and automated accessibility checks. See [frontend scope and verification](frontend.md)
  for evidence and limits; those checks are not a complete XSS or accessibility audit.

Do not remove guards, weaken TLS, enable wildcard CORS, silently add paid resources or
erase evidence to make a demo pass. Keep [frontend handoff](frontend-handoff.md) invariants
when extending the website.
