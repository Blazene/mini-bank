# Frontend — customer workspace, phase 1

React 19, TypeScript 7, Vite 8 and React Router, in the independent `frontend/` package.
The user chose **modern banking**: navy navigation, a warm light workspace, restrained
teal accents, self-hosted Inter/DM Serif fonts and responsive account cards/forms.
No external analytics, font CDN, paid service or new cloud resource is required.

**Status: publicly deployed on the existing Render service as `bf4e142`.**
Open [the website](https://mini-bank-api-2bxt.onrender.com/),
[sign-in](https://mini-bank-api-2bxt.onrender.com/login) or
[sample-data preview](https://mini-bank-api-2bxt.onrender.com/demo/overview), alongside the existing API.
[All three hosted CI jobs passed](https://github.com/Blazene/mini-bank/actions/runs/40202387787).
See [public browser verification and its scope](frontend-deployment.md).
Day 24 is separately published as `1302383` with green CI and a successful Render deploy.

## Run

```sh
npm --prefix frontend ci
npm run dev:web
```

Open **http://127.0.0.1:5173/demo/overview** to explore the preview, or
**http://127.0.0.1:5173/login** for the live customer workspace. Preview and live sessions
are isolated. Preview is explicitly marked, uses deterministic sample data, sends **no API
calls**, and disables write confirmation/account creation/loan submission.

The dev server listens on localhost and proxies `/api` to
`https://mini-bank-api-2bxt.onrender.com` by default. Backend CORS is unchanged, not disabled.
To work entirely locally, start the backend separately, then:

```sh
API_PROXY_TARGET=http://127.0.0.1:3000 npm run dev:web
```

Optional `frontend/.env.local` can be based on its nonsecret `.env.example`; only public
API configuration goes there. **Never** put database/JWT/deploy secrets into Vite variables.
Live-mode operations affect the selected backend, including the hosted demo by default.
Use disposable users/fake money only; there is no automatic cleanup endpoint.

## Implemented

| Area           | Behavior                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication | Register, login, current-user verification, visibility toggle, session-expiry handling, local sign-out; no cookie/localStorage/sessionStorage token persistence                                          |
| Overview       | Authoritative totals and balances, own accounts, recent activity and working navigation/quick actions; honest empty/loading/error states, no invented growth chart                                       |
| Accounts       | Create savings/current, status/balance, own-number reveal/copy and account-filtered activity; uncertain creation prompts checking accounts instead of auto-resubmission                                  |
| Money          | Transfer/deposit/withdraw forms, exact rupees→paise validation, review step, API-confirmed receipt and refreshed balances                                                                                |
| Retry safety   | Immutable body/key per intent, disabled duplicate submission/editing on unknown outcomes, explicit same-key retry, 429 cooldown without auto-submit; a rejected retry does not erase earlier uncertainty |
| Activity       | Owner-scoped records, type/account filters, opaque cursor paging, deduplication, refresh and mobile-readable amounts/dates/status; no cursor timestamp rewriting                                         |
| Loans          | Server-calculated quote/eligibility, pending application with stable retry key, saved application IDs in the current session and owner-only ID lookup/customer-visible review                            |
| Accessibility  | Semantic forms/tables, labeled controls, skip link, visible focus, native dialogs/focus restoration, reduced motion, responsive navigation and automated contrast checks                                 |

Money writes stay pending until the server confirms them. Sidebar navigation warns before
discarding an unfinished write; sign-out is disabled during that state, and unloading warns.
Saved retry requests, tokens and application IDs are **memory-only**. Forced reload, browser
back/close or session loss can discard client state: sign in and inspect activity before
starting a new money intent. This is not durable offline payment reconciliation. App sign-out
only clears the client token; the backend has no token revocation/logout endpoint.

No list-all loan-application API exists, so the UI does not fabricate one. Save the returned
application ID for later lookup. No real loans are disbursed. Admin review/audit/alert screens,
password recovery, payments/bills, cards and repayment features are not implemented in this phase.

## Verification

```sh
npm --prefix frontend test
npm run build:web
npm --prefix frontend audit --audit-level=high
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Playwright starts its own localhost Vite server on **5174**. Browser tests intercept all
API requests; unhandled calls fail locally, not on Neon. Desktop 1440px and mobile 390px
runs exercise preview/no-network behavior, login/storage/reload protection, dialog Escape/
focus return, uncertain transfer retry identity, cursor/filter behavior, expiry and loan
quote/application flows. Axe checks cover sign-in and every customer preview route. These
are automated WCAG-rule checks, not a complete accessibility certification.

Screenshots of preview/sign-in pages are generated under ignored `frontend/artifacts/`.
Failure traces live under ignored `frontend/test-results/`; use only disposable fixture
data in them. Unit/component tests cover exact large paise arithmetic, API configuration,
auth/cookie boundaries, errors/429, write-intent retention and preview isolation.

Verified locally on Node **22.23.3**:

| Check                                   | Result                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend unit/component                 | **43 tests, 4 files passed**                                                                                                                     |
| Chromium desktop + mobile               | **22 checks passed**, including Axe on sign-in and every customer preview view                                                                   |
| TypeScript + production bundle          | Passed                                                                                                                                           |
| Backend regression after static serving | **1034 tests, 73 suites passed**, existing four 95% coverage gates retained                                                                      |
| Static serving and build configuration  | **37 focused tests passed**, plus full post-integration regression                                                                               |
| Backend lint and isolated Docker        | Passed; runtime includes compiled assets only, with website/deep-link/API isolation checks                                                       |
| Backend and frontend dependency audits  | Both reported **zero known vulnerabilities**                                                                                                     |
| Updated workflow validation             | Official checksum-verified actionlint passed (optional ShellCheck/Pyflakes integration disabled)                                                 |
| Public website/API checks               | Render Live; public read-only browser/API checks and bounded disposable business flows verified; see [deployment report](frontend-deployment.md) |

Browser checks caught and corrected pale-text contrast, native-dialog focus return and
mobile transaction readability. These are real fixes, not disabled Axe rules. Local
screenshots were reviewed for desktop/mobile overview, auth and customer pages.

A separate real Chromium → local Express/PostgreSQL smoke check was run against the
guarded `_test` DB: registration/login/me, savings creation, a **1050-paise** deposit,
matching history, **888488-paise** quote EMI and a pending application all passed. The test
DB was cleaned afterward. It did not create or modify hosted business rows. The first
probe raced a SPA tab transition; waiting for the new deposit form resolved the test timing.

Backend Jest ignores the frontend directory and retains its coverage gates. An independent
GitHub Actions job installs the frontend lockfile, runs unit/build/audit and mocked desktop/
mobile browser checks. Check **all three jobs for the deployment commit**; local success is
not a hosted run. Existing backend CI and Docker jobs are retained. Dependabot now tracks
the separate frontend dependency directory too; no existing PR was merged.

## Same-service production hosting

The user selected the **existing Render Free service and URL**, not a separate static site.
`render.yaml` still defines one web service. The frontend and API sleep/cold-start together;
even the sample-data preview must wait for Render to wake before its assets can load.

- Docker's separate frontend stage installs its lockfile, typechecks and runs the production
  build with the public constant `VITE_API_BASE=/api/v1`. The runtime receives only `dist`
  under `/app/public`, not frontend source, tests or build dependencies.
- Express serves `/`, `/login`, `/app/*` and `/demo/*` as SPA navigation routes after the
  existing API routes. Reloading a protected page requires sign-in because tokens are memory-only.
- `/api/v1` still hosts API/Swagger/OpenAPI. Unknown API requests, missing files and unrelated
  routes retain JSON 404s rather than receiving the SPA shell.
- HTML uses `Cache-Control: no-store`; hashed `/assets/*` uses one-year immutable caching;
  favicon/license files revalidate. Helmet applies to both UI and API. Fonts are self-hosted.
- Website requests use the same HTTPS origin, so **leave production `CORS_ORIGINS` unset**.
  The Vite proxy is for local development only, not part of production. Do not add a wildcard,
  cookies, secrets, an admin-grant route or a paid resource.
- Host Node development remains API-only when `/app/public/index.html` is absent; use Vite
  for the local UI or the full Docker stack to verify the bundled website.

Publishing sequence: commit/push, confirm **all three hosted CI jobs**, allow the existing
CI-gated Render auto-deploy, then check the actual public website/API in a browser. Verify
deep-link reloads, assets/fonts/CSP, preview isolation, session/login and bounded disposable
account/money/loan flows. Never reset the hosted database. `vite preview` is only a local tool.

See [API handoff](frontend-handoff.md), [architecture](architecture.md), and
[security review](security-review.md) for the contract and retained backend limitations.
