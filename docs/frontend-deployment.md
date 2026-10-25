# Public frontend deployment — 25 October 2026

The customer website is live on the **same existing Render Free service and URL** as the
Mini Bank API. No extra site, paid plan, custom domain, database, role grant or secret change
was needed. This is an educational demo with simulated money, not a real bank.

## Published version

- Frontend/integration commit: [`bf4e142`](https://github.com/Blazene/mini-bank/commit/bf4e142b052f7fa5aee0ce6a5d83212ed6fd2368).
- [GitHub CI run 40202387787](https://github.com/Blazene/mini-bank/actions/runs/40202387787):
  **all three jobs passed** — backend tests/lint/coverage/audit, frontend unit/build/audit/
  browser checks, and isolated Docker verification.
- Existing service: `mini-bank-api`, Singapore, Free, one instance.
- [Render deployment](https://dashboard.render.com/web/srv-dbev5ve7bikc73bk3oj0/deploys/dep-dbf15749v7es73cuofi0):
  **Deploy succeeded | Live**, source `bf4e142`, automatic CI-gated trigger; dashboard
  reported 59.1 seconds. Startup completed with no new migrations to apply.
- The previous backend deployment was `1302383`; its existing database was retained.

| Public entry point                                                     | Purpose                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| [Website](https://mini-bank-api-2bxt.onrender.com/)                    | Opens the sign-in screen                               |
| [Sign in / register](https://mini-bank-api-2bxt.onrender.com/login)    | API-backed customer workspace                          |
| [Preview](https://mini-bank-api-2bxt.onrender.com/demo/overview)       | Explicitly labeled sample data; no API calls or writes |
| [Health](https://mini-bank-api-2bxt.onrender.com/api/v1/health)        | Application and database readiness                     |
| [Swagger](https://mini-bank-api-2bxt.onrender.com/api/v1/docs/)        | Existing interactive API documentation                 |
| [OpenAPI](https://mini-bank-api-2bxt.onrender.com/api/v1/openapi.json) | Existing API contract                                  |

## Deployment boundaries

Docker builds/typechecks the frontend in a separate stage with `VITE_API_BASE=/api/v1`.
Only compiled files enter runtime `/app/public`; frontend source, tests and build-time
dependencies do not. Private environment files and host dependencies are excluded from
the build context. No database URL, signing secret or cloud credential is frontend input.

Express serves `/`, `/login`, `/app/*` and `/demo/*` after the API routes. HTML is `no-store`;
hashed assets are immutable for one year, and other public files revalidate. API/file typos
remain JSON 404s. Helmet applies to both API and website. Fonts are self-hosted.

Production `CORS_ORIGINS` remains unset/closed: the website calls the same-origin `/api/v1`.
No separate host or wildcard CORS is required. Render and Neon stay on their existing free
plans. Website and API share Render's sleep/cold starts, including the initial preview load.

## Verification

Local final checks passed: **1,034 backend tests / 73 suites**, **43 frontend tests / 4 files**,
**22 desktop/mobile Chromium checks**, strict TypeScript/production build, lint, both dependency
audits (zero known vulnerabilities), actionlint and the full isolated Docker verifier.
The unchanged four backend coverage gates remain at 95%; frontend tests are measured separately.

Actual public Chromium checks, not just build status, verified:

- Root/login rendering and ten preview route/viewport combinations: overview, accounts,
  payments, activity and loans at **1440px** and **390px**; no horizontal page overflow.
- **11 public-page Axe checks** passed: sign-in plus every preview view at both widths.
  These are automated rule checks, not an accessibility certification.
- Deep-link reloads, protected-route redirection to sign-in, self-hosted fonts and no
  cross-origin resource dependencies. Preview made **zero API requests**.
- Real registration/login/current-user, honest empty state, two customer account creations,
  confirmation/receipt flows, activity filtering, loan quote, pending application and ID lookup.
- A **1050-paise deposit**, **100-paise withdrawal** and **250-paise internal transfer**.
  Repeating the original deposit with its exact body/key returned the original transaction,
  `Idempotent-Replayed: true` and the current **700-paise savings balance**, not another credit.
- Loan EMI was **888488 paise**; application creation returned pending and owner lookup
  succeeded. Local/session storage remained empty, and reload returned to sign-in.
- The read-only demo checker passed against the public deployment: database health,
  security headers, closed cross-origin CORS, Swagger/OpenAPI and authentication guards.
- Separate public HTTP checks confirmed HTML/asset cache policy and JSON 404s for unknown
  API versions/routes, missing assets/UI files and private-file probes.

Public screenshots were reviewed under ignored `frontend/artifacts/`. No credentials,
tokens, HARs or authenticated screenshots were published.

### Bounded disposable data and runner notes

Public verification left **two disposable users, four accounts, three money transactions
and one pending application** in place, plus normal access/audit records. The first probe
created a user/two empty accounts, then stopped on an overly strict smoke-test select
locator **before any money request**. The second probe verified the server-confirmed
money/loan checks above; a trailing balance selector raced the SPA's account-page transition,
so that one-off runner did not finish green end-to-end.

The selector problems were reproduced and corrected using the public production assets
with a **guarded local test API/database**; that complete run passed and its local data was
cleaned. This local-API run is **not** claimed as an additional hosted financial test.
The final public **read-only** browser run passed; no more hosted business data was created
just to repeat the entire writable runner. Existing hosted rows were not reset or deleted,
no user was made admin, and credentials/tokens were generated/held in memory without logging.

## Remaining limits

Use disposable information only. Tokens, retry intents and remembered application IDs are
memory-only; reload/sign-out loses client state. Inspect activity before starting a new
money intent after an uncertain result. Admin screens, durable reconciliation, real payment
rails, real loan disbursement and production-bank safeguards are outside this frontend phase.

See [frontend guide](frontend.md), [API handoff](frontend-handoff.md), [architecture](architecture.md)
and the historical [Render/Neon setup](day-23.md).
