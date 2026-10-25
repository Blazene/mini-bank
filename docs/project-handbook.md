# Mini Bank: project handbook

## 1. How to use this document

**Architecture, decisions, trade-offs, limitations, and a complete maintained-file reference.**

- Prepared: **26 October 2026**.
- Source snapshot: **`c0c6593`**, following frontend/integration commit `bf4e142`.
- Repository: https://github.com/Blazene/mini-bank
- Website: https://mini-bank-api-2bxt.onrender.com/
- Sample-data preview: https://mini-bank-api-2bxt.onrender.com/demo/overview
- API documentation: https://mini-bank-api-2bxt.onrender.com/api/v1/docs/

Read sections 2–5 to understand the system, section 6 before changing it, and section 9
when you need to understand a particular file. Section 10 explains local/generated files
that are intentionally not part of the source inventory.

### Scope and honesty

This handbook covers the material architectural, financial, security, frontend, testing,
and deployment decisions visible in the code and recorded development notes. It is not
a claim to know every unstated thought behind every line of code.

**Recorded** means the rationale is stated in project notes/comments or an explicit user
choice. **Inferred rationale** means the implementation is observable, but the suggested
reason is an engineering interpretation, not a historical quotation. Source paths and
the evidence guide make these explanations checkable.

The file reference accounts for **all 228 tracked files in the source snapshot**, including
tests, migrations, lockfiles, documentation, and empty-directory placeholders. This newly
added handbook is described separately. Third-party dependency internals, private `.env`
contents, Git internals, build output, and screenshots are not copied into this document.
No database credentials, signing secrets, access tokens, or cloud credentials belong here.

### What “would break if modified/deleted” means

An arbitrary modification cannot have one guaranteed result. A correct refactor may change
nothing externally; removing a guard may create a security failure without an obvious crash.
The reference therefore describes **deletion without updating dependants** and representative
**unsafe edits**, not a prohibition on maintaining the project.

There are four different times at which a change can matter:

1. **Local source change:** affects your next local run/build, not the already deployed image.
2. **Pushed source change:** triggers CI; the existing deployment normally stays in place
   while checks/builds run. Do not assume this is a substitute for reviewing a change.
3. **New deployed image/configuration:** changes the actual running site/API.
4. **Live database/resource change:** can affect data or availability immediately, independently
   of whether any source file was changed.

Deleting a migration file does **not** undo SQL already applied. Closing your terminal,
Render dashboard, or Neon dashboard does **not** stop cloud hosting. Deleting the Neon
project or destroying a database volume is entirely different from closing a browser tab.

### Contents

1. [How to use this document](#1-how-to-use-this-document)
2. [What was built and how it fits together](#2-what-was-built-and-how-it-fits-together)
3. [Decision register](#3-decision-register)
4. [End-to-end walkthroughs and exact business contracts](#4-end-to-end-walkthroughs-and-exact-business-contracts)
5. [Limitations and production gaps](#5-limitations-and-production-gaps)
6. [Safe-change and troubleshooting playbook](#6-safe-change-and-troubleshooting-playbook)
7. [Local operation, configuration, and deployment reference](#7-local-operation-configuration-and-deployment-reference)
8. [Testing, evidence, and development history](#8-testing-evidence-and-development-history)
9. [Complete file-by-file reference](#9-complete-file-by-file-reference)
10. [Generated, private, and machine-local files](#10-generated-private-and-machine-local-files)
11. [Glossary and maintaining this handbook](#11-glossary-and-maintaining-this-handbook)

## 2. What was built and how it fits together

Mini Bank is a **full-stack educational banking simulator**. It demonstrates careful
money handling and operational engineering; it is not a licensed bank, payment processor,
credit-underwriting service, or production financial ledger.

### 2.1 Implemented capabilities

| Area           | What exists                                                                       | Important boundary                                                                    |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Identity       | Registration, bcrypt passwords, expiring JWT login, current-user lookup           | No password recovery, email verification, refresh token, or central logout/revocation |
| Accounts       | Create/list/read savings and current accounts                                     | Ownership-scoped; new accounts start at zero; no customer freeze/close endpoint       |
| Money          | Simulated deposit, withdrawal, transfer, receipts, retry-safe writes              | No real bank connection or external settlement                                        |
| Activity       | Owner-scoped history, account/type/date API filters, keyset pagination            | UI exposes account/type filters; counterparties are masked                            |
| Loans          | Exact quote/schedule, indicative eligibility, pending applications, owner lookup  | Approval is not funding; no repayments or accrued outstanding balance                 |
| Administration | API-only review, audit listing, monitoring-alert listing/detail                   | No admin frontend or public role-grant endpoint                                       |
| Monitoring     | Large-movement and rapid-outgoing-transfer alerts                                 | Demo heuristics, not fraud detection certification or regulatory AML                  |
| Interface      | Responsive React workspace, review forms, accessible dialogs, sample-data preview | Memory-only sessions/intents; no durable offline reconciliation                       |
| Delivery       | Docker, three CI jobs, Render Free, Neon Free                                     | One app instance, shared UI/API cold starts, no availability guarantee                |

### 2.2 Deployment and trust boundaries

```text
Browser: React UI or Swagger
  | HTTPS; bearer token on authenticated API requests
  v
Render managed HTTPS edge
  | configured trusted app-facing proxy hop
  v
One Node 22 / Express 5 container
  +-- compiled React files from /app/public
  +-- /api/v1 routes, validation, authentication, business rules
  +-- bounded PostgreSQL connection pool
        | direct Neon connection with verified TLS
        v
      Neon PostgreSQL 16: durable application data

GitHub main -> three CI checks -> Render Docker build
             -> validate configuration -> migrate -> exec Node
```

The browser never receives a database password or connects directly to PostgreSQL.
The API is the authority for permissions, balances, loan policy, and successful writes.
The React app is an interface to that authority, not a second bank database.

### 2.3 Internal layers

```text
route -> authentication/rate limit/validation -> controller -> service -> repository -> PostgreSQL
                                                        \-> pure helpers/rules/calculator
```

- **Routes:** define URLs and middleware order.
- **Schemas:** define accepted request shapes, bounds, and normalization.
- **Controllers:** translate HTTP inputs/outputs; choose status/envelope/replay header.
- **Services:** enforce ownership and business rules; coordinate transactions.
- **Repositories:** issue parameterized SQL and map database rows to public objects.
- **Shared middleware/utilities:** cross-cutting behavior, not a place to hide unrelated rules.

SQL generally belongs to its owning repository. Deliberate exceptions include the database
health probe, migrations, operator/test fixtures, and the transaction wrapper. This is a
modular monolith: many well-separated source files, but one deployable API process.

### 2.4 Storage model

| Table               | Purpose                                             | Important relationship/invariant                                   |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `users`             | Identity, password hash, current role               | Case-insensitive unique email; only `user`/`admin` roles           |
| `accounts`          | Owner, number, status, currency, balance            | User FK; unique account number; nonnegative `BIGINT` balance       |
| `transactions`      | One completed ledger movement per successful intent | Correct source/destination shape; scoped idempotency uniqueness    |
| `loan_applications` | Declared inputs, saved quote, terminal review       | Owner and reviewer FKs; no self-review; consistent review metadata |
| `audit_logs`        | Selected request/operator events                    | No user FK by design; UPDATE/DELETE blocked by a trigger           |
| `monitoring_alerts` | Rule evidence associated with a movement            | Transaction/account FKs; one row per transaction/rule              |
| `pgmigrations`      | Migration runner bookkeeping                        | Not a customer business table                                      |

Balances are stored rather than recomputed for every request. Ledger rows support history
and reconciliation, but this is **not a complete double-entry accounting system**. Neither
the transaction table nor alert evidence is made cryptographically immutable by this design.

## 3. Decision register

Each entry explains the choice, why it helps, the price paid, and what a careless
alternative would damage. The file appendix adds the precise maintenance impact.

### 3.1 Architecture, language, and dependencies

**D01 — Modular monolith instead of microservices. Recorded.** One process and one PostgreSQL
database keep cross-account operations inside a single transaction. There is no distributed
commit protocol or network hop between money modules. The cost is one deployment/scaling
unit and shared failure/cold-start boundaries. Splitting money or monitoring into independent
services would require durable event delivery, reconciliation, and new transaction semantics;
moving code into another service is not sufficient.

**D02 — Node.js/Express backend, CommonJS modules. Implementation observed; stack rationale inferred.**
The existing backend uses JavaScript, `require`, and Express 5. This keeps a small API stack
and uses async handlers that Express 5 forwards to the error handler. Backend JavaScript
does not get the frontend's TypeScript compile-time checks. Changing the root package to
ES modules or downgrading Express without adapting imports/error handling can prevent startup
or leave rejected requests mishandled. There is no benchmark proving this stack is faster
than Java, Python, Go, or another alternative.

**D03 — Explicit route/controller/service/repository boundaries. Recorded.** Separating HTTP,
rules, and SQL makes business tests and ownership review easier. It produces more files
and some repetitive wrappers. Bypassing a service or calling an unscoped repository from
a customer controller can silently remove authorization/business guarantees.

**D04 — PostgreSQL and explicit parameterized SQL. Recorded implementation; ORM comparison inferred.**
PostgreSQL provides transactions, row locks, constraints, JSONB, and relational references.
SQL remains visible enough to review lock order and owner predicates. The trade-off is
manual mapping, migrations, and query maintenance. An ORM could also work, but would still
need correct transaction-client propagation and locking. Interpolating user values into
SQL introduces injection risk; an ORM is not what makes this project safe.

**D05 — Node 22, PostgreSQL 16, and locked dependency installs. Recorded.** These are the
tested runtime/database families. Both npm packages have their own lockfiles; CI/Docker use
`npm ci`. This favors repeatable application dependency resolution over silently accepting
new versions. Base-image tags and Node's `22` selector can still move, so builds are not
bit-for-bit reproducible. A Node 26 dependency PR was held rather than treating a version
bump as automatically safe; native bcrypt, CI, startup, and config assertions need retesting.

**D06 — Purpose-specific libraries rather than custom infrastructure. Implementation observed.**
Express handles HTTP, `pg` database access, Zod validation, bcrypt hashing, jsonwebtoken
tokens, Pino logging, Helmet headers, express-rate-limit counters, node-pg-migrate schema
changes, and swagger-ui-express documentation. Frontend libraries provide React routing,
icons, fonts, DOM tests, and browser checks. The inferred benefit is avoiding bespoke versions
of well-understood primitives; the cost is a dependency/supply-chain maintenance obligation.
Deleting a dependency from a manifest without adapting consumers breaks imports or builds.

### 3.2 Money, account identity, transactions, and retries

**D07 — Integer paise, never floating-point rupees. Recorded.** `10.50` rupees becomes JSON
number `1050`. PostgreSQL stores money as `BIGINT`; API conversions reject numbers beyond
JavaScript's safe-integer range. Frontend parsing uses decimal text and `BigInt`, not
`parseFloat(text) * 100`. This is more explicit than decimal-display arithmetic, but avoids
rounding away cents. Sending formatted strings, fractional paise, or raw BigInt JSON breaks
the contract or serialization.

**D08 — Different bounds for a movement, a balance, and a loan. Recorded.** A movement is
at most `1,000,000,000` paise; a balance must remain within the safe-integer API range;
loan principal has a smaller policy bound. These are not interchangeable. Validation,
calculator limits, database checks, documentation, and UI need coordinated updates if a
limit changes. The database's account balance CHECK prevents negative values, but does not
itself enforce every API-level upper bound.

**D09 — Random 12-digit account numbers, UUID internal identifiers. Recorded.** The service
uses `crypto.randomInt`, never starts a number with zero, and retries up to five collisions.
A unique database constraint is the real collision guard. UUIDs identify rows internally;
people supply a recipient account number to transfer. Randomness reduces easy enumeration,
not the need for authorization. These are demo account numbers, not IFSC/IBAN/payment rails.

**D10 — Client controls account type, not balance/owner/status/number. Recorded.** New accounts
start at zero, in INR, active, owned by the authenticated user. Zod strips unknown fields.
This is simple mass-assignment protection, but a misspelled extra field may be ignored
instead of explicitly rejected. Accepting a client-supplied owner, role, balance, or status
would turn ordinary create requests into a privilege or money-creation bypass.

**D11 — One checked-out connection per financial transaction. Recorded.** `withTransaction`
passes the same client through row locking, relative balance updates, ledger insertion,
and monitoring. Every step commits or rolls back together, with release in `finally`.
Using `pool.query` midway can run on a different connection and commit a partial operation.
Transactions introduce lock waits and connection occupancy; they do not make every business
rule in the entire application atomic.

**D12 — Row locks and relative balance updates. Recorded.** `SELECT ... FOR UPDATE` prevents
two requests spending the same stale balance. Updates use `balance = balance + delta`.
Checks happen against the locked row, and the database nonnegative CHECK is a backstop.
This serializes conflicting operations and may increase latency on busy accounts. Removing
the locks or computing a new balance from an unlocked read risks lost updates/overspending.

**D13 — Deterministic lock order for transfers. Recorded.** Both accounts are locked in
ascending normalized UUID order, regardless of transfer direction. Opposing A-to-B/B-to-A
requests therefore do not deliberately take locks in the opposite order. This reduces a
known deadlock pattern; it is not proof that no possible future SQL can deadlock. Additional
locks must follow a compatible global order, and broader workloads may need deadlock retries.

**D14 — Required, scoped idempotency keys. Recorded.** Money requests require an 8–100
character allowed key. Uniqueness is scoped to the initiating account: destination for
deposit, source for withdrawal/transfer. Type, endpoints, amount, and normalized description
must match an existing request. A UUID is a convenient client-generated key. The same key
is not a universal cross-user or cross-account deduplication identifier.

**D15 — Ownership, then replay, then current business checks. Recorded.** The service must
establish source ownership before exposing a saved transaction. A successful retry replays
before checking today's frozen status or insufficient funds. Otherwise an operation that
already committed could be reported as a fresh refusal. A changed payload with the old key
gets 422. Transfer resolution still needs a resolvable destination; this is not a generic
cache that stores every HTTP response forever.

**D16 — Replay returns stable transaction identity, current account state. Recorded.** A
replayed money request returns 201 and `Idempotent-Replayed: true`; no second balance change
or monitoring evaluation occurs. Its balance may differ from the original response because
other movements happened afterward. Consumers must not assume the entire response body is
an immutable snapshot or use a returned current balance to infer the original transaction's
post-write balance.

**D17 — Failed business attempts do not reserve permanent intents. Recorded behavior.** A
rolled-back movement leaves no committed ledger/key row. Corrected input can be retried;
successful intents remain protected by persisted uniqueness. The system does not retain
every failure response or offer an explicit operation-status/reconciliation endpoint. New
keys are new intents, so a client that loses an old key can still request a second movement.

**D18 — Deposits and withdrawals simulate external money. Recorded.** Authenticated callers
can add demo funds to their own account. This is useful for learning transaction behavior
without real bank integrations. It is not verified cash acceptance, settlement, authorization
by an external institution, or proof that an equal asset exists elsewhere.

### 3.3 Authentication, validation, privacy, and request boundaries

**D19 — bcrypt and bounded password input. Recorded.** Registration requires at least eight
characters, a letter, a number, and no more than 72 UTF-8 bytes because bcrypt truncates past
that boundary. The work factor defaults to 12; tests use 4 for speed. Passwords are hashed,
not encrypted or returned. An unknown-email login still compares a dummy hash and uses the
same invalid-credentials message, reducing obvious timing/existence differences; this is
not a guarantee of perfectly constant-time account discovery. Duplicate registration still
returns a specific conflict.

**D20 — Signed, expiring HS256 bearer JWTs. Recorded.** Tokens carry subject and role, plus
timestamps; verification pins the algorithm rather than trusting a token's choice. There
is no per-request session-store lookup in `requireAuth`. This is fast/simple, but copied
tokens remain usable until expiry and role claims can become stale. A random private secret,
HTTPS, algorithm pinning, and safe logs are required; token expiry alone does not solve theft.

**D21 — Different freshness guarantees for different endpoints. Recorded.** `/auth/me`
reloads the current user. Loan review/admin inspection and alert services also check the
current database role. Audit listing relies on JWT role middleware only. Promotion needs
a new login token; demotion is not universally instantaneous. Even a fresh admin lookup
is not locked atomically with an in-flight decision.

**D22 — Operator-only role grant. Recorded.** `make-admin` changes an existing user's role
using operator/database access, not an HTTP setup endpoint. This avoids a self-service
privilege escalation path. The role update and its audit write are separate statements;
audit failure can occur after the role has changed. Do not expose this script as an ordinary
public request handler or claim it is an atomic role-and-audit transaction.

**D23 — Owner predicates and indistinguishable 404s. Recorded.** Customer account/application
reads include the user in the SQL predicate. Missing and not-owned resources share a 404.
Transfer destinations that are unknown/frozen/closed share an unavailable response. This
reduces information leakage, at the cost of less specific diagnostics. Unscoped destination
and admin repository functions are intentional internal capabilities, not safe replacements
for owner-scoped customer queries.

**D24 — Zod at the edge, database constraints underneath. Recorded.** Schemas reject wrong
types, enforce bounds, normalize email/descriptions/defaults, and strip extra fields. SQL
constraints still protect alternate writers and races. Both layers must stay aligned.
Express 5's query getter requires defining an own `req.query` property for cleaned values;
simple assignment can leave controllers using raw strings. Services also validate some
direct-entry loan operations, but not every function is a universal untrusted-input boundary.

**D25 — Consistent errors, small bodies, correct middleware order. Recorded.** The API uses
an error envelope with machine code/message and optional client-error details. Unexpected
5xx responses hide SQL/internal messages; malformed JSON and bodies over 10 KB are mapped
cleanly. Global rate limiting precedes parsing; route-specific auth/audit/validation ordering
is deliberate. Moving error middleware before routes, or catching/ignoring errors, changes
behavior. Requests rejected before route audit hooks are not automatically audited there.

**D26 — Helmet and closed production CORS. Recorded.** UI/API share one HTTPS origin, so
production does not need a separate frontend allowlist. Local development permits cross-origin
behavior unless configured otherwise, and Vite also offers a proxy. CORS controls browser
response access, not authentication, not curl, and not whether every request can be sent.
Broadening it or weakening CSP to fix a deployment symptom is not an appropriate shortcut.

**D27 — Per-process rate limiting with explicit trust-proxy configuration. Recorded.** Limits
cover API traffic, registration, failed logins, outgoing transfers, and destination misses.
This adds no Redis/resource cost, but counters reset on restart and differ across overlapping
or multiple processes. `TRUST_PROXY=1` assumes Render's current topology; blindly trusting
forwarded addresses lets clients spoof rate-limit identity. Successful logins are not
counted like failed logins; once a failed-login window is exhausted, even a correct attempt
can be rejected until it clears.

**D28 — Safe public response mapping and targeted log redaction. Recorded.** Repositories
map snake_case rows into explicit camelCase output, excluding hashes, retry keys, owner/staff
identifiers where inappropriate. Pino redacts Authorization/Cookie/Set-Cookie headers.
This was strengthened after a production-mode probe found credentials in default logs.
Redaction is not permission to log entire bodies or arbitrary sensitive exception strings.

### 3.4 History, audit, and monitoring

**D29 — Keyset pagination instead of offset pagination. Recorded.** History, audit, and alerts
order by `(created_at DESC, id DESC)`, fetch one extra row, and use the last returned row
as the next cursor. This avoids offset shifting and repeated rescans of skipped rows, but
does not offer arbitrary page-number jumps or a total count. Concurrent new rows may require
a refresh; this is not a frozen multi-page database snapshot.

**D30 — Preserve PostgreSQL microseconds in cursors. Recorded.** Cursor timestamps are text
with six fractional digits; converting through JavaScript Date would lose precision.
Base64url is encoding, not encryption or a signature. Validation checks shape/calendar/UUID
and length; authorization still comes from the owner predicate. Date filters use zoned
inputs and `[from, to)` boundaries. The UI forwards opaque cursors without parsing them.

**D31 — Viewer-relative history presentation. Recorded.** A movement can be credit, debit,
or internal depending on which owned accounts are selected. Only owned account IDs are
exposed, and counterparties are masked to the final four characters. This is deliberately
not a recipient-name lookup or a way to enumerate other users. Reusing raw transaction
repository rows directly in a customer statement would defeat this presentation boundary.

**D32 — Selected, minimized, post-response audit logging. Recorded.** Audit hooks record
selected auth, money, application, review, and operator outcomes. Metadata is allowlisted
and bounded; passwords, income/debt, and narrative review reasons are not copied wholesale.
Target route parameters are captured before Express unwinds the router. The logging set
does not include every GET, every account action, or every unauthenticated/global rejection.

**D33 — Best-effort audit delivery and append-only ordinary writes. Recorded.** Audit writes
start after the response, are tracked for shutdown/test flushing, and log their own failures
without changing a committed business result. That preserves truthful responses but can lose
events on a crash. UPDATE/DELETE are blocked by a database trigger; privileged changes,
DROP, and unguarded TRUNCATE are not made impossible. A durable audit/outbox or independently
protected sink would be a new design, not another misleading success assertion.

**D34 — No user FK on audit history. Recorded.** The audit must outlive the identity it
describes, so it stores a UUID without a user foreign key. This preserves history but allows
an identifier with no current user row. Cleanup must explicitly include `audit_logs`, and
privacy/retention policy still needs a production design.

**D35 — Monitoring is atomic with money, unlike request audit. Recorded.** New completed
movements evaluate rules and insert alerts using the same client before COMMIT. An alert
failure rolls back the balances and ledger too. This chooses consistency of movement/evidence
over keeping payments available when monitoring is broken. Swallowing alert errors or moving
insertion to an unrelated connection silently weakens that guarantee.

**D36 — Explicit simple monitoring thresholds and bounded velocity work. Recorded.** Large
means at least Rs 1 lakh. Rapid means the fifth/subsequent completed outgoing transfer in an
inclusive five-minute window. The query counts at most four other qualifying transfers,
adds the current one, and stores `countAtLeast`, not an exact unlimited count. Statement/wall
clock timestamps avoid misleading transaction-start times after lock waits. Rules are
deterministic heuristics with versioned evidence, not learned fraud models, real-time external
alerts, historical backfill, or a review/resolution queue.

### 3.5 Loans and reviews

**D37 — Calculate, apply, review are distinct steps and none moves money. Recorded.** Quotes
are authenticated, read-only calculations without SQL/idempotency keys. A valid but ineligible
quote returns 200 with reasons; invalid input is 400. Applications recompute policy server-side
and save only eligible pending records. Treating a successful quote as credit approval or an
approved application as disbursed money invents guarantees the project does not provide.

**D38 — Server-owned rate and exact reducing-balance arithmetic. Recorded.** The nominal
annual rate is 1200 basis points (12%), with monthly rate `annualRateBps / 120000`. EMI and
interest use BigInt rational arithmetic and half-up rounding. The final installment settles
residual paise; zero interest is supported internally for math tests, not chosen by callers.
This is harder to read than floating-point formulas and does not model APR, fees, dates,
late charges, or bank-specific rounding conventions.

**D39 — Explainable bounded demo eligibility. Recorded.** Principal is Rs 1,000–10 lakh,
tenure 6–360 months, declared income at least Rs 15,000/month, and existing EMI plus the
largest proposed installment must not exceed floor(40% of income). Equality is accepted.
Using the largest installment handles final-payment rounding. Income and existing debt are
self-declared; repeated applications do not enforce aggregate exposure.

**D40 — Save original terms, not a formula to rerun later. Recorded.** A JSONB quote/schedule
snapshot is saved alongside typed input columns. Reads and replays retain the agreed original
terms after a policy/math change; a replay can show the current review status. This duplicates
data, stores schedules up to 360 rows, and has no explicit policy-version field. Recomputing
historical quotes on GET or editing snapshot/input columns independently breaks consistency.

**D41 — Per-user application idempotency backed by a unique constraint. Recorded.** The service
looks for existing terms first, inserts with `ON CONFLICT DO NOTHING`, then uses a fresh
READ COMMITTED statement to read a concurrent winner. Normalized principal, term, income,
and debt must match. This handles races without account locks, but assumes the stated
isolation/snapshot behavior and adds a round trip on conflict. Different keys can create
multiple applications; a uniqueness key is not an exposure cap.

**D42 — One terminal review with natural idempotency. Recorded.** A conditional UPDATE only
changes a pending row; reviewer, reason, and timestamp change together. Another reviewer
cannot overwrite the winner. Only the same actor/decision/trimmed reason replays; different
attempts conflict with 409. No separate idempotency key is needed for this one-time transition.
There is no reversal, appeal, decision-edit history, or funding workflow.

**D43 — No self-review and customer-visible explanations. Recorded.** Current admin role is
rechecked and a borrower cannot review their own application, including when the borrower is
an admin. A database CHECK backs up the actor separation. Reasons are 10–500 Unicode code
points, trimmed, and reject SQL-unsupported text; customers receive reason/time, not reviewer
UUID. Reason length does not ensure meaningful underwriting. Never put confidential staff
notes in the customer-visible field.

**D44 — Migrations preserve dangerous rollback boundaries. Recorded.** Five ordered SQL
migrations evolve the schema. The review/monitoring Down migrations refuse to erase existing
decisions/alerts silently. Other Down operations can still drop data. Applied migrations
are history: append a new migration instead of editing an old file and assuming existing
databases will rerun it. Source rollback is not database rollback or restore.

### 3.6 Frontend, UX, and browser safety

**D45 — Separate React/TypeScript/Vite client package. Recorded choice.** The customer UI
uses React 19, React Router, strict TypeScript, Vite 8, and its own lockfile. The existing
backend was not rewritten just to add a client. Local state/contexts are sufficient for
this scope; the inferred benefit of not adding a global state/cache framework is fewer
abstractions/dependencies. The cost is manual loading/refresh/cancellation logic. TypeScript
types are not runtime validation of server response bodies.

**D46 — Modern banking design without fictitious product promises. Recorded user choice.**
Navy navigation, a light workspace, restrained teal, self-hosted Inter/DM Serif fonts, account
cards, and mobile layouts were selected. Real empty/error/loading states replace fake growth
charts. There are no decorative controls pretending to implement cards, bills, password
recovery, or real bank services. A single sizeable CSS file is easy to locate but increasingly
costly to maintain as responsive overrides accumulate.

**D47 — Explicit isolated preview mode. Recorded.** `/demo/*` uses deterministic sample
users/accounts/history and disables final writes. `/app/*` uses authenticated API data;
distinct provider instances keep state isolated. Preview makes no API requests after assets
load, but those assets must still be downloaded from Render. Removing a preview guard can
turn a harmless design walkthrough into a real hosted-demo mutation.

**D48 — Memory-only bearer token and verified current user. Recorded.** Login is followed
by `/auth/me`; only then is the session established. No cookie/localStorage/sessionStorage
token persistence is used. A 401 clears only the matching sent token, preventing a stale
request from erasing a newer session. Reload/sign-out lose client state and sign-in is needed
again. XSS can still act with in-memory credentials while the page is open; memory storage
is risk reduction, not XSS immunity or server-side token revocation.

**D49 — One strict fetch boundary, same origin, bounded waiting. Recorded implementation.**
The API client sends explicit bearer/key headers, omits browser credentials, refuses redirect
following, avoids request caching, and combines cancellation with a 90-second timeout. Only
the same-origin API path or a constrained HTTPS API base is accepted. This avoids accidentally
shipping tokens to an arbitrary redirect and centralizes error/429 handling. Ninety seconds
can still be too short for an outage or too long for ideal UX; a browser timeout does not
prove PostgreSQL rolled back.

**D50 — Review before submit; no optimistic financial success. Recorded.** Money forms
parse exact paise, select an active owned account, validate visible funds, and ask for a
confirmation before writing. API rules remain authoritative if displayed balances are stale.
Only a server-confirmed response produces a receipt, and balances are refreshed. Recipient
name lookup does not exist; users must double-check the number. This is intentionally more
cautious than instantly updating the UI and reconciling mistakes later.

**D51 — Immutable retry intent and sticky uncertainty. Recorded.** `useSafeWrite` clones the
original path/body/key, blocks duplicate in-flight clicks, and preserves them after network,
408, unreadable-response, or 5xx uncertainty. A later 429 does not erase the original unknown
outcome. Same-intent retries are explicit, never automatic; Retry-After controls a cooldown.
Editing/resetting a potentially committed intent would risk a second payment under a new key.

**D52 — Navigation warnings are a safety aid, not durable recovery. Recorded.** Busy/uncertain
writes lock the form/tabs/sign-out and warn on sidebar navigation/unload. A user can still
force a reload/close, use browser navigation, lose the session, or approve leaving. Retry
intents are not persisted. If state is lost, inspect activity before starting another intent.
This project does not implement a service worker, durable outbox, or universal router blocker.

**D53 — Account creation is not falsely advertised as retry-safe. Recorded.** This endpoint
has no idempotency key contract. If its response is lost, the UI prompts a refresh/check
instead of automatically creating another account. Registration has a similar “may have
completed” operational concern; unique email prevents duplicate identities, but is not a
general saved-response retry mechanism.

**D54 — Session-scoped application list plus ID lookup. Recorded.** There is no list-all
customer loan-applications API, so the UI remembers only submitted/looked-up IDs in memory.
Editing loan inputs clears a prior quote, preventing submission of stale terms under edited
form text. Reload loses the remembered list; save the returned application ID. Inventing a
frontend-only persistent application list would hide rather than solve the missing backend
listing contract.

**D55 — Semantic/native accessibility and self-hosted presentation assets. Recorded.** Forms
have labels, tables retain meaning on mobile, navigation has a skip link, route changes
restore focus/title, dialogs use native modal behavior and restore opener focus, and reduced
motion/contrast fixes are included. Fonts are served locally with license notices; no font
CDN/analytics service is needed. Automated Axe/Chromium checks are useful evidence, not proof
of all keyboard, screen-reader, Safari/Firefox, or assistive-technology behavior.

### 3.7 Packaging, cloud, tests, and maintenance

**D56 — One existing Render service/URL for UI and API. Recorded explicit user choice.**
Bundling the UI into the Node image avoids another service, another public URL, and frontend
CORS configuration. API and Swagger remain under `/api/v1`. The price is shared deploys,
failure modes, bandwidth/resources, and free-tier cold starts. A separate static host could
improve initial UI availability, but would need deliberate API origin/CSP/CORS configuration.

**D57 — Restricted SPA fallback and separate cache policies. Recorded.** Compiled files are
served after API routes; only known UI navigation families receive `index.html`. API typos,
missing assets, and unrelated routes stay JSON 404s. HTML is `no-store`, hashed assets are
immutable for a year, and other files revalidate. A broad `app.get('*')` fallback or long-lived
HTML cache can hide API errors or strand clients on old bundle references. Old lazy-loaded
assets are not retained across every deployment, so more complex code splitting would need
an asset-version strategy.

**D58 — Three Docker stages and a build-context allowlist. Recorded.** Linux production
dependencies, frontend build/typecheck, and non-root runtime are separate. Only compiled UI
assets enter `/app/public`; frontend source/tests/build dependencies stay out of runtime.
No host `node_modules`, `.env`, `.git`, or coverage is copied. Frontend test/config inputs
currently enter the build stage because strict typechecking includes them. New build inputs
need coordinated Dockerfile/allowlist changes. Multi-stage builds reduce the shipped surface,
not the need to trust/audit build-time dependencies.

**D59 — Debian slim, native bcrypt, direct Node startup. Recorded.** Node 22 Bookworm slim
uses the tested glibc/Linux native-dependency path. `USER node` avoids root; direct Node/`exec`
preserves signals; Compose adds an init process for child reaping. Compared with a smaller
or different-libc base this is less minimal, but avoids an untested native compatibility
change. Node-pg-migrate remains a production dependency because deployed startup runs it.

**D60 — Local Compose stays opt-in and retains data. Recorded.** Plain Compose starts only
PostgreSQL; the `app` profile adds migration/API jobs. Database health precedes migrations,
and successful migrations precede API startup. Local ports bind to localhost; containers use
`db:5432`, not the Mac's localhost. A named volume survives normal `down`. Read-only roots,
dropped capabilities, no-new-privileges, and a bounded writable `/tmp` are Compose controls;
they must not be assumed to be Render settings. Deleting volumes is data deletion, not cleanup
of harmless build output.

**D61 — Render bootstrap validates, migrates, then listens. Recorded.** Render Free does
not supply the desired pre-deploy migration job, so its command runs the shell bootstrap.
Configuration/migration failure blocks startup. Direct Neon connections avoid using a
transaction pooler for migrations, and exactly one `sslmode=verify-full` is required. Duplicate
TLS options, host query overrides, pooled endpoints, and global TLS bypass are refused. One
runtime role also runs DDL: convenient for a demo, too much privilege for a real financial app.

**D62 — Render Free plus separate Neon Free in Singapore. Recorded.** This respected the
no-paid-resource constraint and avoided Render's expiring free database product at setup.
Keeping app/DB regions aligned reduces an avoidable network distance; no latency/SLA claim
was measured. Render can sleep; Neon can suspend compute; quotas, account changes, and
provider policies can interrupt service. Dashboards/local terminals are not hosting processes.
The 25 October deployment evidence is historical, not a promise of perpetual free hosting.

**D63 — Bounded connection pool and graceful shutdown. Recorded.** Render uses pool max 5
and a 10-second acquisition timeout. Idle pg errors are handled; shutdown stops new HTTP,
drains tracked audit writes, then closes the pool. This helps serverless DB suspension and
resource limits, but does not provide universal SQL/lock timeouts, durable audit recovery,
or unlimited graceful-shutdown time under a provider's hard termination deadline.

**D64 — Unit, real-PostgreSQL, real-HTTP, container, and browser tests. Recorded.** Pure/mocked
tests cover branches; actual PostgreSQL tests cover locks, constraints, and races; child
process/TCP tests catch lifecycle/parser failures; Docker checks the deployed-style image;
browser tests check the real UI. This costs execution time/tooling. No one layer proves all
others, and a green mocked browser test is not proof the public API is deployed correctly.

**D65 — Test isolation and explicit destructive-operation guards. Recorded.** Backend tests
run serially because shared fixtures reset a test database; resets require a `_test` suffix
and drain audit writes. Docker verification owns randomized images/projects/volumes/ports
and checks isolation before deleting its own resources. Browser tests intercept API traffic
on 5174. A suffix alone is not permission to point tests at valuable data; fixture helpers
that issue raw SQL still require the surrounding isolation discipline.

**D66 — Four 95% backend coverage gates, separate frontend runner. Recorded.** Jest measures
statements, branches, functions, and lines for backend/src and JavaScript scripts, not UI
coverage or the Docker verifier. Frontend Vitest/Playwright remain independent; strict TS
builds cover the included frontend test/config inputs too. Coverage is a regression metric,
not proof of correct requirements, absence of vulnerabilities, or production readiness.

**D67 — Three CI jobs with limited credentials and no production database. Recorded.** Backend
checks run with disposable PostgreSQL; Docker follows backend success; frontend runs independently.
Official actions use full SHA pins, tokens are read-only, checkout credentials are not
persisted, artifacts are scoped/retained seven days, and jobs have timeouts/concurrency
cancellation. There is no privileged pull-request-target workflow, image publication, or
deployment credential in these jobs. Render performs its own CI-gated auto-deploy; branch
protection and cloud access settings remain separate administrator responsibilities.

**D68 — Dependency audits and reviewed updates, not blind upgrades. Recorded.** Both npm
packages are audited; Dependabot watches them, action pins, and Docker. A specific parser
advisory was fixed compatibly, and production logging/TLS validation were separately tested.
`npm audit fix --force` or merging stale green PRs without current-base verification is not
the chosen policy. npm advisory checks are point-in-time and not an OS-container vulnerability
scan, SBOM review, penetration test, or guarantee against unknown issues.

**D69 — Public verification is bounded and honest about test-runner failures. Recorded.**
Health/docs checks default to read-only. Writable verification requires explicit flags, and
remote writes need a second acknowledgement. Disposable rows are left in place; no public
database reset/admin shortcut is used. The frontend deployment report distinguishes a
public run's successful financial assertions from trailing smoke-selector failures and the
subsequent local-API/read-only checks. This is preferable to rerunning writes blindly just
to obtain an unqualified green screenshot.

**D70 — Versioned REST and programmatic OpenAPI with independent contract checks. Recorded implementation; format rationale inferred.**
The existing API lives under `/api/v1` and publishes OpenAPI 3.0.3 from JavaScript, with
same-origin Swagger assets and disabled authorization persistence. This provides a public,
interactive contract without introducing GraphQL or a documentation-hosting service.
Zod/SQL still enforce requests; OpenAPI is not the runtime permission or validation engine.
Maintaining schemas/types in more than one place creates drift risk, so tests compare
mounted routes and actual database-backed response shapes with the published contract.
Adding/changing an operation requires coordinated documentation and client changes, not
only a new route. A future breaking API version would require a deliberate compatibility plan.

## 4. End-to-end walkthroughs and exact business contracts

### 4.1 Registration and login

1. A form/API caller submits email, name, and password; extra `role` is stripped.
2. Email is trimmed/lowercased and password requirements are checked.
3. bcrypt produces a hash; the repository inserts only server-approved fields.
4. Concurrent duplicate email is settled by the unique index, returned as 409.
5. Login compares a real or dummy hash and returns a signed token plus safe user object.
6. The React client separately calls `/auth/me`, stores the token only in memory, then
   opens `/app/overview`. Authentication failures never fabricate a logged-in workspace.

Registration is not an email-verification process. The dummy login hash reduces a timing
signal; it does not hide that duplicate registration has an explicit response.

### 4.2 A transfer and its lost-response retry

Suppose an owned savings account has 10,000 paise and sends 2,500 paise to another account.
The UI displays Rs 25.00, but sends integer JSON `2500` with a UUID retry key.

```text
Authenticate -> route audit hook -> transfer limits -> key validation -> body validation
  -> BEGIN
  -> resolve destination number to UUID
  -> lock the two account rows in sorted UUID order
  -> confirm source ownership and destination presence
  -> find prior matching intent
       matching committed row: return it without another write
       changed payload: refuse, roll back
       absent: continue
  -> check active status, source funds, destination upper bound
  -> source -2500; destination +2500
  -> insert ONE completed ledger row
  -> evaluate/insert monitoring evidence on the SAME client
  -> COMMIT -> 201 receipt
  -> request audit write starts after response completion
```

If the response disappears after COMMIT, a new request with the **same key and same input**
returns the original transaction, not a new transfer. A new key represents a new request
and can move another 2,500 paise. If monitoring insertion fails before COMMIT, both balance
changes and the ledger roll back. If request audit later fails, the committed transfer is
still successful: that failure has a different guarantee.

### 4.3 Statement history

The service first finds the authenticated user's owned account IDs, optionally checks a
requested single account, and queries only movements touching that set. Results are ordered
newest first with UUID tie-breaking. Fetching `limit + 1` indicates whether another page
exists. The next cursor points after the last returned row with full microseconds.

The same movement may be internal in an all-owned-accounts view but debit/credit in a
single-account view. The UI forwards the cursor unchanged, resets on filter changes, and
deduplicates appended rows by transaction ID. Deduplication does not replace correct SQL
pagination. Cursors do not grant access to another user's data.

### 4.4 Loan quote, saved application, and terminal decision

For principal **10,000,000 paise**, 12 months, and declared monthly income **5,000,000 paise**,
the documented fixed-rate EMI is **888,488 paise**. This is Rs 1 lakh principal and Rs 8,884.88
monthly EMI, not an 888,488-rupee installment.

1. `/loans/quote` calculates the reducing-balance schedule and explains indicative eligibility.
2. `/loans/applications` receives normalized inputs and an application retry key, independently
   recalculates policy, then saves pending terms/schedule.
3. A same-user same-key replay returns the saved application; conflicting inputs are 422.
4. Owner GET is scoped to that owner; even an admin uses the separate admin route for broader inspection.
5. Review requires admin JWT role and current DB role, a different actor from the borrower,
   a valid decision/reason, and a still-pending row.
6. One conditional UPDATE wins. Same actor/decision/reason can replay; other terminal changes
   conflict. Reason/time are visible to the customer; balances and ledger do not change.

### 4.5 Browser writes under uncertainty

```text
editing -> review -> submitting -> confirmed receipt
                        |
                        +-> definitive refusal: show error; correction/new intent is possible
                        +-> uncertain: preserve immutable body/path/key; warn and lock editing
                                          |
                                          +-> explicit same-key retry
                                          +-> later 429: wait, but remain uncertain
```

The frontend treats network failure, unreadable JSON, HTTP 408, and 5xx conservatively.
It does not auto-retry a payment. Account creation is handled separately because it lacks
the financial endpoint's retry-key contract. Forced reload can discard the intent even
though the backend's completed key remains stored; inspect history before creating a replacement.

### 4.6 Startup, deployment, and shutdown

- **Host development:** `npm run dev` runs local Node; use Vite separately for the UI. No
  compiled `public/index.html` means the local Node app can remain API-only.
- **Compose app profile:** DB health -> one-off migrations -> Node, with compiled UI in the image.
- **Render:** private env -> bootstrap validation -> migrations -> `exec node src/server.js`.
- **Shutdown:** stop accepting HTTP, wait for server connections to finish, flush tracked
  audit promises, close the pg pool, exit. Hard termination can still interrupt this.
- **Restart/redeploy:** database rows persist in Neon or a retained local volume. In-memory
  rate counters reset. Browser in-memory state is independent from database persistence.

### 4.7 Exact HTTP and policy reference

All API paths below have the prefix `/api/v1`.

| Method/path                                                                      | Access and meaning                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /health`                                                                    | Public DB readiness check; successful `SELECT 1`                                |
| `POST /auth/register`, `POST /auth/login`                                        | Public identity entry points with their own limits                              |
| `GET /auth/me`                                                                   | Signed token plus current-user lookup                                           |
| `POST /accounts`, `GET /accounts`, `GET /accounts/:id`                           | Authenticated, owner-controlled account operations                              |
| `POST /transactions/deposit`, `/transactions/withdraw`, `/transactions/transfer` | Authenticated; required retry key; commit/ledger/monitoring behavior            |
| `GET /transactions`, `GET /accounts/:id/transactions`                            | Owner-scoped history, filters, and cursor                                       |
| `POST /loans/quote`                                                              | Authenticated, read-only calculation                                            |
| `POST /loans/applications`, `GET /loans/applications/:id`                        | Required key on submit; customer owner lookup                                   |
| `GET /admin/loan-applications/:id`, `POST /admin/loan-applications/:id/review`   | Admin JWT plus current role; no self-review                                     |
| `GET /admin/audit-logs`                                                          | Admin JWT role; no fresh DB-role recheck here                                   |
| `GET /admin/alerts`, `GET /admin/alerts/:id`                                     | Admin JWT plus current role                                                     |
| `GET /openapi.json`, `/docs/`                                                    | Public contract and interactive Swagger; Swagger calls can write real demo rows |

| Status        | Interpretation in this project                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| 200 / 201     | Successful read/review/calculation or create; inspect eligibility and replay header where relevant           |
| 400           | Invalid/missing input, malformed JSON, invalid/missing key                                                   |
| 401           | Missing, malformed, expired, or no-longer-valid identity where checked                                       |
| 403           | Role refusal or forbidden self-review                                                                        |
| 404           | Missing route/resource or intentionally concealed ownership/unavailable destination                          |
| 409           | Duplicate email, inactive source account, incompatible terminal review                                       |
| 413           | JSON body over the configured size                                                                           |
| 415           | Unsupported request encoding or JSON character set                                                           |
| 422           | Validly shaped but refused business request: insufficient funds, reused key, ineligible loan, unsafe balance |
| 429           | Rate limit; honor `Retry-After`, do not resubmit in a tight loop                                             |
| 5xx / timeout | Server/infrastructure trouble; write outcome may be uncertain                                                |

| Rule                              | Current value                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Whole-API limiter                 | 300 requests/minute/IP under `/api/v1`, with the health exemption                              |
| Registration limiter              | 10/hour/IP; this is sign-up, not a separate bank-account-creation limit                        |
| Failed login limiters             | 30/15 minutes/IP and 5/15 minutes/email                                                        |
| Transfer limiter                  | 20/minute/authenticated user                                                                   |
| Destination-miss transfer limiter | 10 transfer 404s/15 minutes/user                                                               |
| JSON body / description           | 10 KB / 140 characters                                                                         |
| Key format                        | 8–100 of letters, digits, underscore, dot, colon, hyphen                                       |
| Movement maximum                  | 1,000,000,000 paise = Rs 1 crore                                                               |
| API-safe per-account upper range  | `Number.MAX_SAFE_INTEGER` paise; service checks credits                                        |
| General page sizes                | Default 20, maximum 100; UI activity requests 10, overview 5                                   |
| Large alert / rapid alert         | At least 10,000,000 paise / fifth+ outgoing transfer in five minutes                           |
| Loan principal / tenure           | 100,000–100,000,000 paise / 6–360 months                                                       |
| Loan rate / income / debt         | 1200 bps nominal annual / income at least 1,500,000 paise / maximum 40% monthly debt allowance |
| Review reason                     | 10–500 trimmed Unicode code points, customer-visible                                           |
| Browser fetch timeout             | 90 seconds, not a DB rollback guarantee                                                        |

## 5. Limitations and production gaps

Completion means the agreed portfolio/demo scope is implemented and deployed. It does not
mean the project has become production banking software or requires no maintenance.

| Limitation                                                        | Consequence                                                                 | What a stronger system would need                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Simulated deposits/withdrawals; no external settlement            | Users can create demo funds; no proof of real assets or authorization       | Payment/bank integrations, settlement/reconciliation, operational controls        |
| Not full double-entry accounting                                  | A movement row and balance constraints are not a complete general ledger    | Balanced postings, immutable accounting events, reconciliations, reversals        |
| Self-declared income/debt and multiple applications               | Eligibility can be unrealistic; aggregate approved exposure is not enforced | Verified data, credit policy, exposure reservations/limits and atomic funding     |
| Approval has no funding/repayment lifecycle                       | Approved does not mean paid; saved quote is not current debt                | Funding ledger, repayment schedule servicing, accrual, overdue/collection rules   |
| No KYC/compliance or regulatory controls                          | Not suitable for real customer identities/funds                             | Legal/compliance design, privacy/consent, retention, operational review           |
| Best-effort audits and privileged mutable data                    | Events may be lost; database operators can alter/delete evidence            | Transactional outbox/audit, independent protected sink, access/retention controls |
| Role claims are not uniformly current                             | Audit listing may trust a pre-demotion token; in-flight role races remain   | Central authorization/revocation/version checks and coordinated semantics         |
| Expiring tokens without refresh/revocation/recovery               | Reload/expiry requires login; stolen tokens have a validity window          | Deliberate session/refresh/logout/recovery lifecycle and abuse controls           |
| Memory-only browser state                                         | Retry intent/application list disappears on forced navigation/session loss  | Durable, privacy-reviewed reconciliation/outbox and operation-status APIs         |
| No runtime response-schema checks in the UI                       | Malformed successful JSON can still break assumptions despite TS types      | Runtime decoding, versioned API contracts, error boundaries as appropriate        |
| Local-only single-process counters                                | Restarts/deploy overlap reset or split rate-limit state                     | Shared limiter store and verified proxy/client-IP handling                        |
| No universal SQL/lock/request deadline design                     | A request can wait on the DB longer than the browser waits                  | Statement/lock deadlines, cancellation semantics, retry/reconciliation policy     |
| Same-runtime UI/API and free tiers                                | Shared outages/cold starts, quotas, no SLA/HA                               | Availability targets, capacity planning, static/CDN strategy, resilient data tier |
| One role runs runtime queries and migrations                      | An app compromise has excessive DB permissions                              | Separate migration/runtime roles and least-privilege grants                       |
| Backup/restore/retention not demonstrated as a production program | Provider persistence is not a tested recovery guarantee                     | Scheduled backups, restore drills, retention/deletion and incident plans          |
| Simple monitoring heuristics                                      | False positives/negatives; no case lifecycle or historical backfill         | Risk model/evaluation, alert ownership/resolution, notifications and controls     |
| No list-all loan API or admin frontend                            | Users save IDs; admins need operator/API workflow                           | New bounded authorized endpoints and deliberately scoped UI                       |
| Mutable base tags, advisory-only dependency checks                | Dependencies and OS surface still change or contain unknown issues          | Digest strategy, updates, image scans, SBOM/supply-chain/security review          |
| Test scope is finite                                              | Chromium/mocks/concurrency examples are not every platform/workload         | Cross-browser/manual accessibility, load/fault/recovery/security testing          |

Other intentionally absent features include multi-currency/FX, cards, bills, beneficiary
name verification, transaction reversal/disputes, customer account lifecycle management,
email verification/reset flows, user data deletion, and a formal service-level objective.
There is also no WebSocket/realtime balance push: the UI refreshes after its own writes
and explicit reload/refresh actions, while the API rechecks authoritative state on writes.
The schema permits some statuses/types that have no customer API workflow; a database
column is not evidence that the corresponding product feature exists.

### 5.1 Priorities if extending the project

1. Preserve the current invariants and add carefully scoped customer application listing
   or API response validation if improving portfolio usability.
2. For higher-assurance operation, address durable reconciliation/audit, authorization/session
   lifecycle, least-privilege DB roles, and restore/incident procedures before cosmetic growth.
3. Add real money only after a fundamentally broader security, accounting, operational,
   regulatory, and integration design. Do not present a few additional tests as that redesign.

## 6. Safe-change and troubleshooting playbook

### 6.1 Files that must change together

| Intended change                  | Coupled files/areas                                                                                  | Likely careless failure                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Change a money amount bound/unit | Transaction schema/service, DB assumptions, OpenAPI, frontend parser/forms, tests                    | 100x money mistakes, precision overflow, accepted UI values rejected by API      |
| Change transfer behavior         | Transactions service/repository, account locks, monitoring, retry identity, ledger/concurrency tests | Partial updates, duplicate payments, deadlocks, missing evidence                 |
| Add a writable account field     | Account schema/service/repository, migration, permission design, OpenAPI/client types                | Client-controlled owner/balance/status or incompatible response                  |
| Change a response field/name     | Repository presentation/controller, OpenAPI, TS types, components, contract fixtures                 | Broken UI or documentation; TS alone cannot protect a runtime JSON change        |
| Change a URL/router prefix       | Module mounts/routes, client calls, Vite proxy, static fallback, OpenAPI/tests                       | API 404s, lost deep links, HTML returned to API clients                          |
| Change a loan policy/rate        | Schema/service/calculator if relevant, new DB migration for bounds, docs/UI, boundary tests          | Invalid schedules, incorrect eligibility, historical terms changing              |
| Add/change an audit action       | Audit action allowlist, hooks, action schema/OpenAPI/tests                                           | Startup rejection for unknown action or sensitive metadata copied                |
| Add/change a monitoring rule     | Rules, service/query, SQL CHECK via a new migration, response/docs/tests                             | Alert insert fails and rolls back legitimate money, or evidence silently missing |
| Add a public UI route            | App routing, Express navigation allowlist, deep-link tests                                           | Client navigation works but reload returns 404                                   |
| Change token storage/base URL    | Session/API client, CSP/CORS/deployment design, tests                                                | Persistent credential exposure, cross-origin failures, tokens sent to wrong host |
| Change runtime/Node/base image   | Docker stages, CI version assertions, dependency/native builds, deployment tests                     | CI failure or Linux-only bcrypt/runtime failure                                  |
| Add a Docker build input         | Dockerfile and `.dockerignore`                                                                       | Works on your host but COPY/typecheck fails in CI/Render                         |
| Add a database table             | New migration, repositories, test cleanup/FKs, verification/schema tests                             | Fresh deployments fail or tests leak rows between cases                          |
| Add another instance/proxy       | Shared limits, DB pool budget, trust topology, migrations/deploy coordination                        | Spoofed IPs, ineffective throttling, excess DB connections                       |

### 6.2 Before deleting or renaming a file

1. Search both `require` and `import`, configuration paths, Docker COPY/allowlist entries,
   tests, and documentation. Dynamic/configured dependencies are not all visible in an IDE's
   reference counter.
2. Classify the effect: startup/build, public contract, security/data integrity, test coverage,
   documentation, legal obligation, or optional presentation.
3. Preserve behavior or intentionally version/change the contract; update callers and tests.
4. Never delete an applied migration as a substitute for a new migration or rollback plan.
5. Run the relevant checks locally and all CI before deployment. Confirm the actual public
   service afterward; a built image is not a browser verification.

### 6.3 Common symptoms

| Symptom                                          | First places to inspect                                                    | Do not “fix” it by                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Local `localhost` stops after terminal closes    | The local Node/Vite process; this is expected                              | Assuming the Render service stopped too                                  |
| Public site takes a long time to open            | Render sleep/quota/status, then health and Neon readiness                  | Repeated registration/payment clicks or disabling guards                 |
| Health fails and DB routes fail                  | Runtime env, Neon availability, TLS/direct-host settings, pool budget      | Printing the connection URL or disabling certificate verification        |
| API works but homepage is 404                    | Image contains `/app/public/index.html`; frontend Docker stage/mount       | Adding a broad fallback that consumes unknown API routes                 |
| Navigation works but a UI deep-link reload fails | Express SPA allowlist, client route, asset paths                           | Replacing every 404 with HTML                                            |
| JS/JSON parse error from a fetch                 | Actual response status/content-type, API prefix, SPA protection            | Treating an HTML shell as a successful API response                      |
| `npm ci` fails                                   | Manifest/lockfile agreement, supported Node version, registry availability | Deleting the lockfile and claiming the new dependency tree is equivalent |
| Test reset refuses the target                    | Database name/selection and `_test` safety check                           | Removing the guard to use a valuable database                            |
| Correct login is rate-limited                    | Failed-login window and Retry-After                                        | Disabling production limits globally                                     |
| Money response is missing/5xx                    | Preserve request key/payload; inspect activity/current state               | Sending the same intended payment under a new key                        |
| Admin token is refused after promotion           | Fresh login and current DB role; endpoint freshness semantics              | Adding an HTTP role-grant endpoint                                       |
| Schema differs between local and hosted          | Migration history, target environment, new migration availability          | Editing already-applied SQL and expecting automatic repair               |

### 6.4 Recovery and rollback boundaries

- Restoring a source file from a reviewed Git commit repairs source, not changed database rows.
- Deploying an earlier image does not reverse migrations or restore deleted data.
- A destructive schema/data operation needs a deliberate backup/restore or forward-fix plan.
- Do not remove append-only/rollback guards simply to make a migration command succeed.
- Do not run the test reset helper, normal-volume deletion, or raw cleanup against Neon.
- Restarts reset limiter counters and may interrupt clients; they are not reliable evidence
  that an uncertain money request did or did not commit.

## 7. Local operation, configuration, and deployment reference

### 7.1 Commands and their side effects

Run commands from the repository root unless specified. Local PostgreSQL/Docker availability
and correctly separated private/test configuration are prerequisites. The test database must
already exist on first local setup; CI creates its own.

```sh
# Install each package's locked dependencies.
npm ci
npm --prefix frontend ci

# Start only the local database, then apply schema to the configured development DB.
docker compose up -d
npm run migrate -- up

# Local API. Stopping this affects localhost, not Render.
npm run dev

# In another terminal: local UI against the LOCAL API.
API_PROXY_TARGET=http://127.0.0.1:3000 npm run dev:web
```

**Important:** plain `npm run dev:web` defaults to proxying the hosted API. Live-mode UI
writes then persist on Neon. `/demo/overview` is the explicit sample-data/no-API preview.
Production uses same-origin `/api/v1`; it does not depend on the Vite server remaining open.

```sh
# Alternative: compiled UI + API + DB in the local full stack.
docker compose --profile app up --build -d --wait

# Stop that normal local project while retaining its database volume.
docker compose --profile app down

# Backend: migrations against the test DB, serial tests, coverage gates.
npm test
npm run lint

# Frontend: separate DOM tests, strict typecheck and build, mocked browser flows.
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e

# Dependency checks for each independent package.
npm audit --audit-level=high
npm --prefix frontend audit --audit-level=high

# Isolated Docker verification; removes ONLY its owned random project/resources.
npm run test:docker

# Explicit read-only public checker; no business rows created by default.
npm run verify:demo -- --base-url https://mini-bank-api-2bxt.onrender.com
```

`npm test` is intentionally **not read-only**: it migrates/resets the disposable test
database. The Docker verifier writes to its isolated database and cleans up that project.
The public verifier's `--write` mode also writes, and remote writes additionally require
`--allow-remote-writes`; use only with deliberate authorization/disposable data. There is
no reason to use writable public verification just to read this handbook.

### 7.2 Configuration without exposing secrets

| Variable                           | Role and change risk                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | Chooses test env file and production behavior. Misclassification can load the wrong DB/CORS/logging mode.                                     |
| `DATABASE_URL`                     | Private backend PostgreSQL connection. Wrong target can mix environments or destroy valuable data during testing. Never a frontend variable.  |
| `JWT_SECRET`                       | Private signing key, at least 32 characters. A public placeholder of adequate length is still insecure; rotation invalidates existing tokens. |
| `JWT_EXPIRES_IN`                   | Token validity, default `1h`. Longer improves convenience but increases theft/stale-role exposure.                                            |
| `BCRYPT_ROUNDS`                    | Password work factor, 4–15, default 12. Test value 4 is not the production recommendation.                                                    |
| `PORT`                             | Host Node listener, default 3000; Render supplies 10000. Must match platform routing/health expectations.                                     |
| `RATE_LIMIT_ENABLED`               | Literal `true`/`false`. String coercion is deliberately explicit so `"false"` does not become truthy.                                         |
| `TRUST_PROXY`                      | Number of trusted proxy hops. Wrong trust can collapse client identity or trust spoofed headers.                                              |
| `CORS_ORIGINS`                     | Exact origin allowlist. Leave unset for the deployed same-origin UI/API. No wildcards/paths.                                                  |
| `DB_POOL_MAX`                      | Per-process connection limit, default 10, Render 5. Multiply by instances when budgeting DB connections.                                      |
| `DB_CONNECTION_TIMEOUT_MS`         | Pool acquisition timeout, default 10000. Does not impose a universal SQL execution deadline.                                                  |
| `VITE_API_BASE`                    | Public compile-time browser API base, deployed as `/api/v1`. `VITE_` values are not a secret store.                                           |
| `API_PROXY_TARGET`                 | Local Vite server proxy destination. A hosted target makes live-mode local UI writes remote.                                                  |
| `API_PORT`, `DB_PORT`, `APP_IMAGE` | Optional local Compose host-port/image selectors, not the same as internal container DNS/ports.                                               |

The repository versions only nonsecret examples/test configuration. `.env` and private
variants must stay ignored. Provider dashboards hold production secrets; opening or closing
their tabs does not start/stop the services. No private values were needed to prepare this
source-based document.

### 7.3 Publishing an intentional future change

Review the diff, run checks, commit/push only when authorized, confirm all three CI jobs for
that commit, allow the existing CI-gated Render deployment, then verify root/login/preview,
deep links, static headers/assets, health/Swagger, and affected API behavior. Read-only public
checks should come first. Keep provider plans/resources, secrets, and database state unchanged
unless the change explicitly requires and authorizes them.

This handbook itself does not change runtime code, migrate data, create cloud resources,
or authorize a new production deployment.

## 8. Testing, evidence, and development history

### 8.1 What was verified at completion

The 25 October completion reports record **1,034 backend tests across 73 Jest suites**,
**43 frontend tests across four files**, **22 desktop/mobile Chromium checks**, strict UI
typecheck/build, lint, dependency audits, workflow validation, and isolated Docker verification.
The four 95% gates cover backend/src and JavaScript scripts, not the entire repository or UI.
These are historical verification results, not a claim that this documentation task reran
all checks or re-audited today's dependency advisory database.

Hosted CI for the frontend implementation:
https://github.com/Blazene/mini-bank/actions/runs/40202387787

Hosted CI for the documentation follow-up/source snapshot:
https://github.com/Blazene/mini-bank/actions/runs/40203636464

The public deployment report separately records real browser/assets/health checks and
bounded disposable financial writes, including a same-key replay. It explicitly describes
the smoke-test selector failures and the distinction between public API checks and a
complete corrected run against a guarded local API. Do not collapse those into an invented
perfect end-to-end hosted run.

### 8.2 Why the layers of tests are different

| Layer                             | Proves useful things about                                                      | Does not by itself prove                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Pure/unit/mocked service tests    | Arithmetic, branches, validation, middleware order/calls                        | Actual SQL locks, database constraints, real infrastructure                      |
| Supertest + real PostgreSQL       | API contract, ownership, transaction state, concurrent races                    | Production proxy/TLS/image/browser behavior                                      |
| Child-process real HTTP           | Listening/shutdown/parser survivability over TCP                                | Every provider failure or load pattern                                           |
| OpenAPI structure/response checks | Documented routes, refs, actual response shapes                                 | Business correctness simply because a response matches a schema                  |
| Isolated Docker stack             | Linux native dependencies, image contents, startup/migration, logs, persistence | Render's exact policy/network topology or a production OS security audit         |
| Frontend DOM/Vitest               | Component/utility behavior and no-network preview guards                        | Real browser modal/focus/layout or public API connectivity                       |
| Playwright/Axe                    | Chromium desktop/mobile flows and selected accessibility rules                  | All devices/engines/screen readers, comprehensive WCAG conformance               |
| Actual public smoke checks        | That the selected deployed website/API really works for bounded cases           | Long-term uptime, high load, all failures, backup recovery or regulatory fitness |

Tests should fail for behavior regressions, not be deleted to obtain a green badge. A
deleted test may leave the application running and even leave CI green; the loss is often
**confidence and regression protection**, not an immediate outage. Coverage can also fall
below the gate, but removing any one test does not automatically guarantee that outcome.

### 8.3 Evolution visible in Git

The commit history progresses from scaffold/health/schema, to registration/login/guards,
accounts, atomic deposits/withdrawals, idempotency, ordered-lock transfers, history, limits,
audits/operator tooling, quotes, applications, review, monitoring, coverage, OpenAPI/dependency
fixes, Docker/log redaction, CI, Render/Neon, backend hardening, and finally the React UI and
same-service deployment.

Key source anchors include `1f436eb` (atomic deposit/withdrawal), `67b3a88` (transfers),
`4b1c183` (history), `e29b070` (audits), `e3a906e` (quotes), `460c91c` (review), `d0698c1`
(monitoring), `0770b6f` (Docker), `47949cc` (CI), `5eb216e` (cloud setup), `1302383`
(hardening/handoff), `bf4e142` (frontend/bundling), and `c0c6593` (public verification notes).

### 8.4 Reading historical notes correctly

The day reports are snapshots. Earlier statements such as “CORS is open,” “not deployed,”
“two CI jobs,” or smaller test counts can be true **at that earlier stage** and stale for
the completed system. Prefer current source, the frontend/deployment reports, and this
snapshot-based handbook for current behavior. The detailed loan decision table explains
some rationale more deeply than a short README can.

## 9. Complete file-by-file reference

Paths below are repository-relative. **Deletion** means no replacement and no coordinated
caller/configuration update. **Unsafe edit** names a specific representative hazard.
Runtimes use built/deployed copies, not a live view of your local files.

The following tables list the 228 source-snapshot files individually. Test rows use the
common test-deletion rule in section 8.2; their last column names the specific protection
that would be lost or falsified. Documentation rows have no direct production runtime effect.

### 9.1 Root configuration, dependencies, CI, and deployment

| File                       | What it does                                                                                                   | Deletion / unsafe modification impact                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dockerignore`            | Allowlist for backend runtime and frontend build inputs; excludes private files/host dependencies.             | Delete: default context can include secrets/unwanted files. Unsafe edit: exclude required build inputs or include private files; Docker COPY/build/privacy breaks.                                             |
| `.env.example`             | Nonsecret local backend configuration template with variable names and safe placeholder intent.                | Delete: onboarding loses the template, not deployed secrets. Unsafe edit: publishing real values leaks credentials; stale examples misconfigure local startup.                                                 |
| `.env.test`                | Deliberately non-production local Jest/test DB defaults.                                                       | Delete: tests need equivalent injected env or fail/use wrong configuration. Unsafe edit: a valuable DB target risks destructive resets; never make it a production secret file.                                |
| `.github/dependabot.yml`   | Weekly updates for backend/frontend npm, action pins, and Docker; no auto-merge policy.                        | Delete: scheduled dependency PR coverage stops, not the running API. Unsafe edit: omit an ecosystem or assume automatic updates are tested approvals.                                                          |
| `.github/workflows/ci.yml` | Three jobs, disposable DB, gates, read-only permissions, SHA pins, artifacts/timeouts.                         | Delete: GitHub checks disappear and Render's check gate may no longer protect deployments as intended. Unsafe edit: skipped gates, leaked secrets, unsafe PR permissions, or false green builds.               |
| `.gitignore`               | Keeps dependencies, private env variants, coverage, builds, traces/screenshots out of Git.                     | Delete: secrets/generated files become easy to add. Unsafe edit: broad exceptions expose private files or hide intended source. It does not erase old committed secrets.                                       |
| `.prettierrc`              | Shared formatting preferences: quotes, semicolons, line width.                                                 | Delete: formatting defaults/diffs change; runtime does not depend on it. Unsafe edit: inconsistent churn; this is not a security or TypeScript configuration.                                                  |
| `Dockerfile`               | Production dependencies, frontend build/typecheck, runtime assembly, non-root user, healthcheck/start command. | Delete: Docker/Render builds fail. Unsafe edit: missing assets/imports, host-native bcrypt, root execution, secrets/dev tools shipped, or incorrect signals/health behavior.                                   |
| `README.md`                | Main onboarding, commands, API/hosting overview, links and safety boundaries.                                  | Delete: app still runs, but usage/portfolio entry and linked guidance disappear. Unsafe edit: dangerous commands, stale hosted claims, or broken links mislead operators.                                      |
| `docker-compose.yml`       | Local DB/volume and opt-in app/migration services with readiness/security settings.                            | Delete: documented local Compose workflows/verifier fail, not existing Neon. Unsafe edit: wrong DB DNS, exposed ports, lost volume persistence, startup before migrations, or weaker isolation.                |
| `eslint.config.js`         | Root JavaScript lint scope/rules and generated-output ignores.                                                 | Delete: ESLint's expected config is unavailable. Unsafe edit: excessive exclusions hide issues; current config is modest and is not a dedicated TS/React lint setup.                                           |
| `jest.config.js`           | Backend test discovery, frontend exclusion, coverage collection/reporters and four 95% gates.                  | Delete: defaults can discover wrong tests and remove intended coverage rules. Unsafe edit: count UI incorrectly, skip important code, or lower confidence without fixing behavior.                             |
| `package-lock.json`        | Exact resolved backend dependency graph/integrity metadata for `npm ci`.                                       | Delete: CI/Docker locked installs fail. Unsafe edit: manifest mismatch fails installation; dependency changes need review/tests/audit, not hand-edited integrity values.                                       |
| `package.json`             | Backend manifest, scripts, production/dev dependencies, migration/test/operator commands.                      | Delete: npm installs/commands and Docker fail. Unsafe edit: missing runtime modules, wrong entrypoints, unsafe test DB selection, or incompatible module/runtime assumptions.                                  |
| `render.yaml`              | One Free Singapore Docker service, health/startup/CI trigger and nonsecret/private-env declarations.           | Delete: existing cloud resources do not automatically vanish, but blueprint recreation/management and config checks lose their source. Unsafe edit: wrong plan, command, port, pool, proxy or secret handling. |

### 9.2 Database migrations and placeholders

| File                                                | What it does                                                                                  | Deletion / unsafe modification impact                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/migrations/.gitkeep`                            | Historical directory placeholder; SQL now keeps this directory nonempty.                      | No runtime/schema effect if removed. It is not a migration and is not a prerequisite for creating tables.                                                                                           |
| `db/migrations/1791983458278_init-schema.sql`       | Creates users/accounts/transactions, constraints, FKs and retry/history indexes.              | Delete: fresh schema/recreation fails; existing tables are not undone. Unsafe edit: weakening balances/ownership references/uniqueness, incompatible future history, or destructive Down migration. |
| `db/migrations/1792800000000_audit-logs.sql`        | Creates audit table/indexes plus ordinary UPDATE/DELETE-blocking trigger.                     | Delete: fresh audit writes/listing fail. Unsafe edit: missing append-only guard/indexes or false FK assumptions; Down removes audit evidence.                                                       |
| `db/migrations/1792886400000_loan-applications.sql` | Creates bounded application inputs, quote JSONB, owner FK and per-user key uniqueness.        | Delete: later review migration/fresh loan API fail. Unsafe edit: duplicate intents, invalid terms or inconsistent bounds; changing applied SQL does not upgrade an existing DB.                     |
| `db/migrations/1792972800000_loan-review.sql`       | Adds reviewer/reason/time and terminal-state checks; guarded rollback.                        | Delete: fresh application queries/decisions lack required columns. Unsafe edit: self-review/incomplete decisions become possible or rollback erases review history.                                 |
| `db/migrations/1793059200000_monitoring-alerts.sql` | Creates alert evidence/FKs/indexes/uniqueness and refuses destructive rollback when nonempty. | Delete: fresh money operations can fail on missing alert table. Unsafe edit: invalid evidence/duplicate alerts, slow queries, or erased history; alert errors roll back money.                      |
| `db/seeds/.gitkeep`                                 | Keeps the intentionally empty optional seed directory in Git.                                 | No runtime effect if removed; an empty directory may disappear from a clone. It does not seed users or provision an admin.                                                                          |

### 9.3 Operator and verification scripts

| File                      | What it does                                                                                  | Deletion / unsafe modification impact                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/make-admin.js`   | Operator CLI/library to promote an existing user, write an audit event, and close the pool.   | Delete: `make-admin`, its Docker copy and CLI tests fail, though ordinary API handlers do not import it. Unsafe edit: public escalation, false success, leaked inputs, or assumed atomic audit. |
| `scripts/start-render.sh` | Fail-fast private configuration/Neon TLS validation, migrations, then exec Node.              | Delete: Render bootstrap and Docker COPY fail. Unsafe edit: API starts before schema, wrong host/TLS bypass accepted, secret-bearing error printed, or signals lost in a shell.                 |
| `scripts/verify-demo.js`  | Opt-in HTTP health/docs/auth checks; explicitly acknowledged writable disposable walkthrough. | Delete: `verify:demo`, its integration tests and Docker verifier import fail. Unsafe edit: unacknowledged remote writes, credential output, redirects, data reset or misleading checks.         |

### 9.4 Backend entrypoints and configuration

| File                   | What it does                                                                                      | Deletion / unsafe modification impact                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app.js`           | Composes trust proxy, Helmet/CORS/limits/parser/logging, API, optional frontend and error chain.  | Delete: server/tests cannot import the app. Unsafe edit: middleware order bypasses limits/auth/error handling, static UI shadows API, or headers/log privacy regress.            |
| `src/server.js`        | Opens listener; handles SIGINT/SIGTERM, HTTP close, audit flush, pool close and exit.             | Delete: npm/Docker listener startup fails. Unsafe edit: premature pool close, dropped audits/requests, duplicate cleanup or hung shutdown.                                       |
| `src/config/env.js`    | Selects env file and validates/coerces all runtime settings with Zod.                             | Delete: most backend imports fail. Unsafe edit: wrong test/prod target, truthy `"false"`, invalid CORS/proxy/pool limits, or insecure defaults accepted.                         |
| `src/config/db.js`     | Shared pg pool, idle error handling, query facade and same-client transaction wrapper.            | Delete: DB-backed modules fail at startup. Unsafe edit: partial commits, leaked clients, wrong TLS/pool target, swallowed rollback/original errors or unhandled idle disconnect. |
| `src/modules/index.js` | Mounts all API modules under specific prefixes, including nested account history before accounts. | Delete: app import fails. Unsafe edit: missing/wrong/shadowed routes or mounting unprotected handlers changes the public contract.                                               |

### 9.5 Authentication module

| File                                  | What it does                                                                                                | Deletion / unsafe modification impact                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/modules/auth/auth.controller.js` | Register/login/me HTTP envelopes/statuses; supplies resolved user to auth audit hooks.                      | Delete: auth router import fails. Unsafe edit: leak unsafe service objects, break client token/user shape, lose actor attribution or wrong status.                 |
| `src/modules/auth/auth.middleware.js` | Parses Bearer header, verifies identity, sets `req.user`, and enforces allowed JWT roles.                   | Delete: protected routers cannot load. Unsafe edit: unauthenticated access, role bypass, trusting forged headers or checking roles before identity.                |
| `src/modules/auth/auth.repository.js` | Parameterized user reads/inserts, isolated hash lookup, safe user mapping and operator role update.         | Delete: auth/role services fail. Unsafe edit: expose hashes, remove email/owner predicates, inject SQL, or permit role writes from inappropriate callers.          |
| `src/modules/auth/auth.routes.js`     | Auth endpoints with deliberate audit/limit/schema ordering and protected current-user route.                | Delete: mounted auth import fails. Unsafe edit: miss failed-attempt audit, unnormalized login limiter keys, missing auth or changed URLs.                          |
| `src/modules/auth/auth.schema.js`     | Normalizes email; validates name/password/byte bounds; login checks only required credentials.              | Delete: auth router fails. Unsafe edit: bcrypt truncation collisions, unexpected roles/fields, inconsistent emails or wrong login-vs-registration policy.          |
| `src/modules/auth/auth.service.js`    | bcrypt hashing/comparison, dummy compare, duplicate-email translation, signing and current-user validation. | Delete: auth controller fails. Unsafe edit: plaintext storage, user-enumeration differences, swallowed DB failures, or deleted users accepted by `/me`.            |
| `src/modules/auth/auth.tokens.js`     | Signs/verifies HS256 access tokens and maps expired/invalid token errors.                                   | Delete: middleware/service imports fail. Unsafe edit: algorithm confusion, weak/incorrect secret use, unbounded expiry, wrong subjects or raw verification errors. |

### 9.6 Account module

| File                                          | What it does                                                                                                            | Deletion / unsafe modification impact                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/accounts/accounts.controller.js` | Owner create/list/detail HTTP adapter, deriving user ID from auth state.                                                | Delete: account router fails to load. Unsafe edit: trust request-body ownership, wrong public envelope or create/read statuses.                                       |
| `src/modules/accounts/accounts.repository.js` | Owner-scoped account SQL, safe balance mapping, transactional locks/relative updates and internal recipient resolution. | Delete: accounts, transfers and history break. Unsafe edit: IDOR, unlocked spending, wrong-client updates, precision loss or exposing an internal unscoped read.      |
| `src/modules/accounts/accounts.routes.js`     | Router-wide authentication and create/list/UUID-detail validation.                                                      | Delete: mounted account API import fails. Unsafe edit: new route accidentally public, missing parameter checks or route-order conflicts.                              |
| `src/modules/accounts/accounts.schema.js`     | Allows only savings/current selection and validates account UUIDs.                                                      | Delete: account/history routers fail to load. Unsafe edit: client-owned balance/status/owner fields, invalid IDs or unsynchronized account types.                     |
| `src/modules/accounts/accounts.service.js`    | Random number generation/collision retry, owner list and concealed detail lookup.                                       | Delete: account controller import fails. Unsafe edit: predictable/duplicate identifiers, retrying unrelated DB errors, ownership leakage or infinite collision retry. |

### 9.7 Money and history module

| File                                                  | What it does                                                                                                                       | Deletion / unsafe modification impact                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/modules/transactions/accountHistory.routes.js`   | Authenticated nested account-history router with `mergeParams` and both path/query validation.                                     | Delete: module mount fails. Unsafe edit: losing the parent account ID, owner scope or validated date/cursor inputs.                                                      |
| `src/modules/transactions/history.controller.js`      | Calls owner-scoped history for global or path-account views; path ID overrides query selection.                                    | Delete: history routes fail. Unsafe edit: request query selects a different account than the path or response/pagination shape changes.                                  |
| `src/modules/transactions/history.cursor.js`          | Compatibility re-export of the shared cursor codec, still consumed by history/tests.                                               | Delete: remaining imports fail. Unsafe edit: history cursor format drifts from shared audit/alert semantics. Can be removed only with coordinated importer changes.      |
| `src/modules/transactions/history.repository.js`      | Scoped parameterized movement search, date/type filters, keyset tuple order, full-microsecond cursor text.                         | Delete: history service fails. Unsafe edit: cross-user rows, SQL injection, gaps/repeats, timestamp truncation or unbounded scans.                                       |
| `src/modules/transactions/history.schema.js`          | History filters/UUID/type plus shared page/date/cursor validation and compatibility exports.                                       | Delete: history routes fail. Unsafe edit: unexpected raw strings/ranges, invalid movement type, relaxed bounds or broken shared-export consumers.                        |
| `src/modules/transactions/history.service.js`         | Derives owned account set, conceals absent ownership, presents credit/debit/internal and masked counterparties, builds pagination. | Delete: controllers fail. Unsafe edit: account enumeration, leaked IDs/numbers, wrong direction or cursor based on the unreturned extra row.                             |
| `src/modules/transactions/transactions.controller.js` | Deposit/withdraw/transfer adapters; injects validated key and sets replay header/201 envelope.                                     | Delete: money routes fail. Unsafe edit: body overrides trusted identity/key, lost replay signal, wrong receipt shape or status.                                          |
| `src/modules/transactions/transactions.repository.js` | Inserts/maps ledger rows, looks up scoped retry keys, and counts bounded recent outgoing transfers.                                | Delete: money/history/monitoring imports fail. Unsafe edit: wrong retry scope, precision loss, wrong transaction client/timestamps or velocity evidence.                 |
| `src/modules/transactions/transactions.routes.js`     | Authenticated history/movement URLs, audit hooks, retry/schema checks, transfer throttles.                                         | Delete: mounted module fails. Unsafe edit: missing auth/key/limits/audit or unexpected endpoint names changes financial safety/contracts.                                |
| `src/modules/transactions/transactions.schema.js`     | Strict numeric paise/amount bounds, optional bounded description, own-source UUID and recipient number shape.                      | Delete: money router fails. Unsafe edit: strings/fractional/oversized amounts, forged fields or invalid account-number types accepted.                                   |
| `src/modules/transactions/transactions.service.js`    | Central money rules, owner locks, ordered transfer locks, replay comparison, funds/bounds, balances/ledger/monitoring transaction. | Delete: money controllers fail. Unsafe edit: double spending, partial money, duplicate intent, deadlocks or false failure/success semantics. Highest-risk business file. |

### 9.8 Loan module

| File                                            | What it does                                                                                                                       | Deletion / unsafe modification impact                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/loans/adminApplications.routes.js` | Admin inspection/review routes with role/schema checks and review audit hook.                                                      | Delete: module mount fails. Unsafe edit: unprotected application access, self-review path or missing refusal/target audit.                                          |
| `src/modules/loans/applications.controller.js`  | Creates/reads customer applications, using authenticated owner/key and replay header.                                              | Delete: customer loan routes fail. Unsafe edit: forged owner/key, wrong saved-application envelope or replay/status handling.                                       |
| `src/modules/loans/applications.repository.js`  | Persists snapshots/inputs, per-user key conflict handling, owner reads, internal admin reads and conditional pending decision SQL. | Delete: applications/reviews fail. Unsafe edit: privacy leak, duplicate/overwritten terms, lost pending predicate, reviewer disclosure or changed decision history. |
| `src/modules/loans/applications.service.js`     | Normalizes input; replays saved terms before new eligibility; resolves concurrent insertion winner and concealed owner lookup.     | Delete: application controller fails. Unsafe edit: trust client quote, policy-dependent retry refusal, changed-input replay accepted or duplicate race.             |
| `src/modules/loans/loans.calculator.js`         | Pure bounded BigInt annuity schedule with half-up rounding and final-payment reconciliation.                                       | Delete: quote/application service fails. Unsafe edit: wrong monthly rate/rounding, inconsistent totals, negative final balance or JSON BigInt serialization.        |
| `src/modules/loans/loans.controller.js`         | Read-only quote HTTP adapter returning `{ quote }`.                                                                                | Delete: quote router fails. Unsafe edit: save data during quotes, return an incompatible shape or mislabel ineligibility as successful approval.                    |
| `src/modules/loans/loans.routes.js`             | Authenticated quote, keyed application creation and owner detail routes.                                                           | Delete: module mount fails. Unsafe edit: unauthenticated sensitive operations, missing input/key checks or invented listing/funding semantics.                      |
| `src/modules/loans/loans.schema.js`             | Principal/income/debt/term/UUID bounds and Unicode-safe customer-visible review reason validation.                                 | Delete: loan/review imports fail. Unsafe edit: policy/calculator/DB mismatch, invalid SQL text, status/owner mass assignment or wrong reason length.                |
| `src/modules/loans/loans.service.js`            | Fixed rate, minimum income, floored debt allowance, highest-installment eligibility and reasons.                                   | Delete: quote/application calculations fail. Unsafe edit: client-owned pricing, exact-boundary refusals or ignored existing debt/final installment.                 |
| `src/modules/loans/reviews.controller.js`       | Admin detail/review HTTP envelopes and natural-replay header.                                                                      | Delete: admin loan router fails. Unsafe edit: wrong actor/result, replay mutation or incompatible customer/admin response.                                          |
| `src/modules/loans/reviews.service.js`          | Current-role verification, no self-review, pending decision race handling and actor/decision/reason replay.                        | Delete: admin controllers fail. Unsafe edit: stale/demoted access, self-approval, overwritten decisions or another admin claiming the previous result.              |

### 9.9 Audit module

| File                                    | What it does                                                                                                      | Deletion / unsafe modification impact                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/audit/audit.actions.js`    | Approved action vocabulary and bounded field-by-field metadata extraction/masking.                                | Delete: audit routes/hooks fail. Unsafe edit: password/income/reason leakage, arbitrary body persistence or invalid action filters.                |
| `src/modules/audit/audit.controller.js` | Admin query-to-service adapter returning logs/pagination.                                                         | Delete: audit router fails. Unsafe edit: response/filter drift; do not assume this wrapper performs a fresh role lookup.                           |
| `src/modules/audit/audit.middleware.js` | Checks hook action at setup, captures route target, records outcome on response finish without crashing delivery. | Delete: audited routers fail at import. Unsafe edit: missed refusals/actor/target, pre-commit false audit or logging exceptions crashing requests. |
| `src/modules/audit/audit.repository.js` | Audit insert and parameterized filtered, microsecond-preserving keyset reads.                                     | Delete: hooks/listing/operator audit fail. Unsafe edit: SQL injection, lost metadata, pagination gaps or incorrect retention behavior.             |
| `src/modules/audit/audit.routes.js`     | JWT-authenticated admin-only audit listing with query validation.                                                 | Delete: module mount fails. Unsafe edit: expose sensitive logs to customers or accept unbounded/unvalidated filters.                               |
| `src/modules/audit/audit.schema.js`     | Approved action/outcome/user/date/page/cursor filter schema.                                                      | Delete: audit router fails. Unsafe edit: unsupported/unbounded filters or failure to track the shared action vocabulary.                           |
| `src/modules/audit/audit.service.js`    | Best-effort tracked asynchronous writes, flush helper, and paginated log assembly.                                | Delete: hooks/server/tests fail. Unsafe edit: unhandled write rejection, misleading transfer errors, shutdown/reset races or wrong cursor.         |

### 9.10 Monitoring module

| File                                              | What it does                                                                                       | Deletion / unsafe modification impact                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/monitoring/monitoring.controller.js` | Passes authenticated admin ID and validated filters/id to alert service.                           | Delete: alert router fails. Unsafe edit: bypass current-admin service path or change detail/list envelopes.                                              |
| `src/modules/monitoring/monitoring.repository.js` | Same-client idempotent evidence insert and parameterized filtered alert reads.                     | Delete: monitoring/money import fails. Unsafe edit: evidence outside money transaction, duplicate alerts, privacy leakage or broken indexes/columns.     |
| `src/modules/monitoring/monitoring.routes.js`     | Admin JWT gates and query/UUID validation on list/detail endpoints.                                | Delete: module mount fails. Unsafe edit: public/customer alert access or unvalidated broad queries.                                                      |
| `src/modules/monitoring/monitoring.rules.js`      | Pure inclusive threshold/count rules and bounded versioned evidence fields.                        | Delete: monitoring service fails. Unsafe edit: off-by-one thresholds, wrong paise scale, misleading exact counts or unsupported DB rule codes.           |
| `src/modules/monitoring/monitoring.schema.js`     | Allowed rule/severity/UUID/date/page/cursor filters and alert-id schema.                           | Delete: alert router fails. Unsafe edit: invalid rule filters, no bounds or different date semantics.                                                    |
| `src/modules/monitoring/monitoring.service.js`    | Records rules on new completed movements with propagated errors; fresh-admin reads and pagination. | Delete: money service/controllers fail. Unsafe edit: swallowed monitoring failure, retroactive replay alerts, non-atomic evidence or stale admin access. |

### 9.11 Health, contract, and shared backend code

| File                                         | What it does                                                                                          | Deletion / unsafe modification impact                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/health/health.routes.js`        | Public `SELECT 1` database readiness route.                                                           | Delete: module import fails. Unsafe edit: always return OK despite broken DB, leak errors or break Render/Docker health paths.                                                      |
| `src/modules/docs/docs.routes.js`            | Serves OpenAPI and Swagger using same-origin assets with token persistence disabled.                  | Delete: mounted docs import fails. Unsafe edit: broken Swagger paths/CSP or persisted browser authorization.                                                                        |
| `src/modules/docs/openapi.js`                | Programmatic OpenAPI 3.0.3 contract: schemas, security, errors, examples and operations.              | Delete: docs router/import fails. Unsafe edit: misleading clients, invalid refs or undocumented real operations; structural/actual-response tests should catch many drifts.         |
| `src/shared/middleware/corsOptions.js`       | Production-closed/development-permissive origin policy plus exposed retry/rate headers.               | Delete: app import fails. Unsafe edit: blocked intended frontend or overbroad browser permission; CORS still is not authorization.                                                  |
| `src/shared/middleware/errorHandler.js`      | Final four-argument Express error adapter, parser error mapping, 5xx logging/redaction boundary.      | Delete: app import fails. Unsafe edit: leaked SQL internals, wrong error envelopes, hidden failures or wrong Express middleware classification.                                     |
| `src/shared/middleware/frontend.js`          | Optional compiled-client mount, asset caching, API exclusion and restricted HTML navigation fallback. | Delete: app import fails. Missing build alone instead leaves API-only mode. Unsafe edit: cached old HTML, API errors disguised as HTML, hidden-file exposure or missing deep links. |
| `src/shared/middleware/idempotencyKey.js`    | Validates required key header and attaches trusted normalized key field to the request.               | Delete: money/application router imports fail. Unsafe edit: absent/repeated/invalid keys accepted or downstream services given a different key.                                     |
| `src/shared/middleware/notFound.js`          | Converts unmatched routes to uniform 404 `AppError`.                                                  | Delete: app import fails. Unsafe edit: HTML/default errors leak through or unrelated routes become false successes.                                                                 |
| `src/shared/middleware/rateLimit.js`         | Constants/stores/middleware for API, sign-up, login and transfer limits, plus test reset helper.      | Delete: app/routers fail. Unsafe edit: spoofable keys, wrong units, successful-login penalties, missing exposed headers or accidental production disabling.                         |
| `src/shared/middleware/validate.js`          | Parses body/params/query; maps issues to 400 and replaces inputs with cleaned values.                 | Delete: most routers fail. Unsafe edit: raw inputs survive, unknown fields reach writes, or Express query-getter behavior bypasses normalization.                                   |
| `src/shared/utils/AppError.js`               | Expected operational error type carrying status/code/details.                                         | Delete: business/middleware imports fail. Unsafe edit: errors become wrong status, clients lose machine codes, or server internals leak as client errors.                           |
| `src/shared/utils/calendar.js`               | Validates real calendar dates, including years below 100, instead of accepting Date normalization.    | Delete: shared pagination imports fail. Unsafe edit: impossible dates reach PostgreSQL as server errors or valid historical dates are misclassified.                                |
| `src/shared/utils/logger.js`                 | Shared Pino logger, quiet in tests and info elsewhere, credential-header redaction.                   | Delete: app/config/services/server fail. Unsafe edit: bearer/cookie exposure, lost diagnostics or tests failing to cover production serialization.                                  |
| `src/shared/utils/mask.js`                   | Replaces all but the final four account-number characters with Xs.                                    | Delete: history/audit imports fail. Unsafe edit: counterparty number leakage or changed presentation expectations.                                                                  |
| `src/shared/utils/money.js`                  | Checked pg BIGINT-string to safe JavaScript-number conversion.                                        | Delete: account/transaction/application repositories fail. Unsafe edit: silently rounded balances or throwing on valid boundary values.                                             |
| `src/shared/utils/pagination.cursor.js`      | Shared base64url cursor encode/decode with exact timestamp/UUID/calendar checks.                      | Delete: history/audit/alerts fail. Unsafe edit: millisecond truncation, invalid cursors, format incompatibility or false belief that encoding grants authorization.                 |
| `src/shared/validation/pagination.schema.js` | Shared bounded limits, zoned dates, decoded cursors and increasing range validation.                  | Delete: history/audit/alert schemas fail. Unsafe edit: unbounded queries, wrong half-open range behavior or inconsistent module paging.                                             |

### 9.12 Frontend package, assets, entrypoints, and shared UI

Frontend source is imported into a build, not individually served by the production API.
A missing imported file generally fails typechecking/Vite before a new image can deploy.

| File                                       | What it does                                                                                                   | Deletion / unsafe modification impact                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/.env.example`                    | Public API-base/local-proxy template and explicit no-secrets warning.                                          | Delete: local frontend setup loses guidance. Unsafe edit: Vite-baked secrets, wrong hosted-write target or invalid base configuration.                                     |
| `frontend/README.md`                       | Short frontend run/test/live-link guide.                                                                       | No direct runtime impact if removed; setup/scope links become missing. Unsafe edit can misrepresent proxy behavior or safe preview.                                        |
| `frontend/index.html`                      | Vite HTML entry, viewport/language/meta/favicon and root mount.                                                | Delete: frontend production build fails. Unsafe edit: missing `root`/entry causes blank app, bad mobile rendering or external asset dependencies.                          |
| `frontend/package-lock.json`               | Exact independent UI/build/test dependency resolution.                                                         | Delete: frontend CI/Docker `npm ci` fails. Unsafe edit: incompatible graph/integrity or unreproducible upgrade assumptions.                                                |
| `frontend/package.json`                    | UI scripts, supported Node floor, React/router/fonts and type/test/build dependencies.                         | Delete: UI installs/builds and Docker fail. Unsafe edit: missing imported library, incompatible React/Vite/tooling or loss of tests/typecheck.                             |
| `frontend/playwright.config.ts`            | Desktop/mobile Chromium projects, local 5174 server, timeouts and failure traces.                              | Delete: browser test setup/discovery and Docker COPY fail. Unsafe edit: accidental cloud traffic, reused wrong server, leaked traces or ignored viewport checks.           |
| `frontend/tsconfig.json`                   | Strict no-emit typechecking for source, configs and e2e inputs.                                                | Delete: expected build/typecheck and Docker COPY fail. Unsafe edit: hidden type errors, unsupported browser target, untyped test/config drift.                             |
| `frontend/vite.config.ts`                  | React build plugin, strict localhost 5173 dev server, `/api` proxy and Vitest/jsdom setup.                     | Delete: Docker COPY fails; local build/test/proxy behavior changes. Unsafe edit: remote writes unintentionally, ignored tests, exposed dev listener or missing JSX plugin. |
| `frontend/public/favicon.svg`              | Self-hosted browser tab icon copied into dist.                                                                 | Delete: favicon request becomes 404; banking functionality remains. Unsafe edit can break the icon or add unwanted external content.                                       |
| `frontend/public/font-licenses.txt`        | Required self-hosted font copyright/OFL distribution notices.                                                  | Delete: UI still renders but font redistribution obligations are not properly preserved. It is legal/attribution content, not a functional dependency.                     |
| `frontend/src/main.tsx`                    | React mount, StrictMode, self-hosted font imports and stylesheet entry.                                        | Delete: UI entry build fails. Unsafe edit: blank root, missing fonts/styles or changed development lifecycle assumptions.                                                  |
| `frontend/src/App.tsx`                     | Router/provider root, private guard, isolated preview/live route trees, route focus/title/scroll.              | Delete: UI build fails. Unsafe edit: accidental preview/live state mixing, inaccessible route changes, broken redirects or misleading client-only authorization.           |
| `frontend/src/styles.css`                  | Full navy/teal design, responsive layout, controls, dialog, contrast, focus and reduced-motion rules.          | Delete: imported stylesheet build fails. Empty/unsafe changes can leave UI unstyled, overflowing, low-contrast or keyboard-unusable while the API still works.             |
| `frontend/src/components/Transactions.tsx` | Shared viewer-direction/history table with exact amounts and mobile date/status presentation.                  | Delete: overview/activity builds fail. Unsafe edit: wrong debit/credit/internal meaning, lost masking/readability or inaccessible table content.                           |
| `frontend/src/components/Workspace.tsx`    | Desktop/mobile navigation, shared layout, disclaimers, profile sign-out and pending-write navigation warnings. | Delete: route frame build fails. Unsafe edit: lost routes, unprotected state loss during writes, false real-banking claims or broken mobile navigation.                    |
| `frontend/src/components/ui.tsx`           | Brand, status/error/loading/empty/heading components and native focus-restoring modal.                         | Delete: many pages fail to build. Unsafe edit: inaccessible labels/focus, closable busy dialogs, hidden errors or incorrect modal lifecycle.                               |
| `frontend/src/context/Bank.tsx`            | Preview/live account source, abortable refresh, remembered applications and navigation lock.                   | Delete: most workspace pages fail. Unsafe edit: sample balances shown as live, stale account responses, application duplication or lost pending-write protections.         |
| `frontend/src/context/Session.tsx`         | Memory-only token, API instance, login/me sequence, matching-token 401 expiry and local logout.                | Delete: routing/client/hooks fail. Unsafe edit: persistent token exposure, stale 401 clearing a new session or trusting login without current-user verification.           |

### 9.13 Frontend libraries and pages

| File                               | What it does                                                                                                      | Deletion / unsafe modification impact                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/lib/api.ts`          | Strict public API base, fetch/auth/key/cancellation policy, typed error/validation/429 presentation.              | Delete: session/pages/hooks fail to build. Unsafe edit: cookies/redirect token leakage, swallowed unknown write outcomes, bad timeout or missing structured errors.              |
| `frontend/src/lib/demo.ts`         | Deterministic fake preview user/accounts/history.                                                                 | Delete: preview consumers fail to build. Unsafe edit: expose real data in shipped bundle or silently make sample totals inconsistent. No backend business rows are created here. |
| `frontend/src/lib/money.ts`        | Exact decimal-text parsing, paise formatting, BigInt total balances and display dates.                            | Delete: money/summary/loan UI builds fail. Unsafe edit: 100x unit errors, rounded cents, unsafe sums or misleading date display. Display dates must not rewrite cursors.         |
| `frontend/src/lib/types.ts`        | UI-facing TypeScript shapes for users/accounts/history/quotes/applications.                                       | Delete: typechecking/imports fail. Unsafe edit: build-time contract drift or false confidence; these types do not validate a live JSON body.                                     |
| `frontend/src/lib/useSafeWrite.ts` | Immutable retry intent, in-flight guard, sticky uncertainty, cooldown and navigation/unload coordination.         | Delete: payments/loan builds fail. Unsafe edit: duplicate financial/application intent, changed same-key payload, premature reset or automatic resubmission.                     |
| `frontend/src/pages/Accounts.tsx`  | Account list/status/balances, own-number reveal/copy and create dialog with uncertain-outcome check.              | Delete: route import/build fails. Unsafe edit: false account creation success, repeated unkeyed create, exposed number or unsafe preview write.                                  |
| `frontend/src/pages/Activity.tsx`  | Account/type URL filters, API/sample history, abortable refresh, opaque cursor loading and dedupe.                | Delete: route import/build fails. Unsafe edit: stale filters, rewritten cursors, duplicate/missing rows or preview calling the hosted API.                                       |
| `frontend/src/pages/Auth.tsx`      | Registration/login forms, field/error/busy states, password visibility, preview link and educational warning.     | Delete: sign-in route build fails. Unsafe edit: duplicate submissions, wrong credential endpoint/mode or omitted error/expired-session handling.                                 |
| `frontend/src/pages/Loans.tsx`     | Quote input/eligibility, saved quoted input, safe application submission, session list and owner-ID lookup.       | Delete: route import/build fails. Unsafe edit: submit stale/edited terms, imply real funding, lose replay state or invent backend listing behavior.                              |
| `frontend/src/pages/Overview.tsx`  | Authoritative total/type balances, own-account cards, recent activity and links with honest loading/empty/errors. | Delete: overview import/build fails. Unsafe edit: invented analytics, sample/live data confusion, unsafe number sums or stale refresh/cancellation behavior.                     |
| `frontend/src/pages/Payments.tsx`  | Transfer/deposit/withdraw tabs, exact validation, immutable review/confirmation, receipt and balance refresh.     | Delete: money route build fails. Unsafe edit: wrong amount/account, editable uncertain intent, optimistic success, unsafe recipient handling or enabled preview confirmation.    |

### 9.14 Frontend tests and fixtures

Removing these tests normally removes regression protection rather than changing the
deployed UI. Removing the configured setup file breaks Vitest; browser/config inputs are
also included in strict typechecking. Do not treat a passing smaller suite as equivalent.

| File                                     | What it exercises/provides                                                                                             | Specific deletion / unsafe-edit risk                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `frontend/e2e/workspace.spec.ts`         | Mock-only Chromium desktop/mobile flows, Axe, preview isolation, retry identity, cursor filters, expiry and loans.     | Lose real-browser guards; removing request interception can let tests mutate the hosted API through Vite.       |
| `frontend/src/App.test.tsx`              | Preview route no-network checks, private redirect, disabled preview create and login/me empty state with no storage.   | Preview/auth/storage regressions may pass unnoticed; do not replace behavior with snapshots alone.              |
| `frontend/src/lib/api.test.ts`           | API-base restrictions, headers/cookies/redirects, 401, validation errors, Retry-After and uncertain response handling. | Credential-boundary and error-semantics regressions lose their direct guard.                                    |
| `frontend/src/lib/money.test.ts`         | Exact parsing, invalid bounds, large safe amounts, BigInt sums and formatting.                                         | Rounding/units/overflow errors become easier to ship.                                                           |
| `frontend/src/lib/useSafeWrite.test.tsx` | Stable immutable key/body through uncertainty and 429, duplicate clicks and definitive-refusal correction.             | Duplicate-intent or erased-uncertainty regressions lose targeted coverage.                                      |
| `frontend/src/test/setup.ts`             | DOM matchers, cleanup, scroll stub and test-only dialog method shims.                                                  | Vitest setup/matcher/dialog tests fail; shims must not be mistaken for real browser accessibility verification. |

### 9.15 Backend configuration and lifecycle tests

| File                                          | What it exercises                                                                                    | Specific deletion / unsafe-edit risk                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/server.test.js`                | Listener port/readiness, HTTP-audit-pool shutdown order, repeated signals and cleanup errors.        | Lose lifecycle/signal regression checks; blind mocks can conceal dropped audit or premature pool closure.         |
| `src/config/__tests__/db.options.test.js`     | Pool limits/acquisition timeout and handled idle pg errors without weakened TLS.                     | Lose guard against pool misconfiguration or unhandled suspended-DB disconnects.                                   |
| `src/config/__tests__/env.deployment.test.js` | Deployment defaults, bounded connections and exact-origin parsing.                                   | Unsafe origin/pool defaults may no longer be caught.                                                              |
| `src/config/__tests__/env.rateLimit.test.js`  | Literal boolean handling and numeric trusted-proxy validation.                                       | `"false"` coercion or malformed proxy configuration may silently change security behavior.                        |
| `src/config/__tests__/runtime.config.test.js` | Env-file selection and production/test logging with mocked dotenv/Pino, without reading private env. | Lose environment-isolation/logging assertions; unsafe edits could read real developer configuration during tests. |

### 9.16 Backend module unit tests

The three `.gitkeep` rows are placeholders, not executable test suites.

| File                                                              | What it exercises                                                                                                | Specific deletion / unsafe-edit risk                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/modules/accounts/__tests__/.gitkeep`                         | Historical test-directory placeholder.                                                                           | No runtime/test effect; other tests already keep the directory in Git.                         |
| `src/modules/accounts/__tests__/accounts.repository.test.js`      | Destination row disappearing between account-number lookup and locking.                                          | Lose the defensive null-result branch check, not the full integration suite.                   |
| `src/modules/accounts/__tests__/accounts.schema.test.js`          | Allowed type, UUID and dropped client-owned fields.                                                              | Mass-assignment/type validation regressions lose direct coverage.                              |
| `src/modules/accounts/__tests__/accounts.service.test.js`         | Number allocation/collision bounds, owner lookup and concealed 404.                                              | Unbounded/unrelated retries or ownership errors may escape unit checks.                        |
| `src/modules/auth/__tests__/.gitkeep`                             | Historical test-directory placeholder.                                                                           | No runtime/test effect; real test files remain.                                                |
| `src/modules/auth/__tests__/auth.middleware.test.js`              | Bearer parsing, forged/expired tokens and ordered role authorization.                                            | Lose direct authentication/role-fail-closed regression checks.                                 |
| `src/modules/auth/__tests__/auth.schema.test.js`                  | Email/name/password normalization, strength, byte limits and ignored role.                                       | Invalid inputs, bcrypt truncation boundaries and writable-role regressions may be missed.      |
| `src/modules/auth/__tests__/auth.service.test.js`                 | Unexpected registration DB errors are not disguised as duplicate emails; hash shape.                             | Operational faults may be mislabeled as ordinary client conflicts.                             |
| `src/modules/auth/__tests__/auth.tokens.test.js`                  | Subject/role/expiry, wrong secret, tampering, unsigned and wrong-algorithm tokens.                               | Lose explicit signing/verification security regression evidence.                               |
| `src/modules/audit/__tests__/audit.actions.test.js`               | Metadata/action whitelist, sensitive-field exclusion, types/bounds and recipient masking.                        | Body/password/income/reason leakage may no longer be caught.                                   |
| `src/modules/audit/__tests__/audit.middleware.test.js`            | Setup-time action validation, finish timing, actor/target capture and safe failure handling.                     | Misplaced hooks or logging exceptions can silently lose/falsify audit events.                  |
| `src/modules/audit/__tests__/audit.schema.test.js`                | Action/outcome/user/date/cursor/limit filter validation.                                                         | Unsupported/unbounded audit queries lose schema checks.                                        |
| `src/modules/audit/__tests__/audit.service.test.js`               | Nonblocking safe writes, pending flush and correct page/cursor assembly.                                         | Audit/shutdown races and pagination mistakes lose focused coverage.                            |
| `src/modules/docs/__tests__/openapi.test.js`                      | Structural/ref validation, mounted-operation coverage, security/key declarations and same-origin Swagger assets. | Contract drift, missing routes/security and unsafe docs delivery may be missed.                |
| `src/modules/health/__tests__/health.failure.test.js`             | Failed DB probe reaches a sanitized server error.                                                                | False readiness or database-error exposure loses its dedicated failure-path check.             |
| `src/modules/loans/__tests__/applications.service.test.js`        | Saved server terms, replay-before-policy, ineligibility, concurrent winner/conflict and scoped reads.            | Loan duplicate/forged-term/owner/retry regressions lose unit evidence.                         |
| `src/modules/loans/__tests__/loans.calculator.test.js`            | Known EMI, zero rate, exact half-up rounding and schedule reconciliation/bounds.                                 | Incorrect installments, totals or final balance become easier to ship.                         |
| `src/modules/loans/__tests__/loans.http.test.js`                  | Authenticated read-only quote behavior and rejection of client-owned policy fields.                              | Quotes could gain unintended SQL/key/approval behavior without these HTTP checks.              |
| `src/modules/loans/__tests__/loans.schema.test.js`                | Input type/bounds/default debt and stripped policy/role fields.                                                  | Boundary or normalization changes lose direct checks.                                          |
| `src/modules/loans/__tests__/loans.service.test.js`               | Server rate, inclusive income/debt thresholds, highest installment and floored allowance.                        | Off-by-one eligibility or ignored existing/final debt may pass unnoticed.                      |
| `src/modules/loans/__tests__/reviews.schema.test.js`              | Allowed decisions, trimming, Unicode code-point reason lengths and unsupported text.                             | Client/SQL length disagreement or invalid review reasons lose a guard.                         |
| `src/modules/loans/__tests__/reviews.service.test.js`             | Current admin, deleted/demoted identity, self-review, pending races and exact-actor replay.                      | Privilege/decision-overwrite regressions lose targeted service checks.                         |
| `src/modules/monitoring/__tests__/monitoring.rules.test.js`       | Inclusive amount/count boundaries, noncompleted rows and dual-rule matches.                                      | Paise-scale/off-by-one evidence errors lose deterministic tests.                               |
| `src/modules/monitoring/__tests__/monitoring.schema.test.js`      | Allowed filters, UUID/date/limit normalization and detail IDs.                                                   | Invalid/unbounded alert query behavior loses direct schema coverage.                           |
| `src/modules/monitoring/__tests__/monitoring.service.test.js`     | Same-client inserts, propagated failures, new-row-only evaluation, current-admin reads and pagination.           | Non-atomic alerts or stale admin access may escape unit checks.                                |
| `src/modules/transactions/__tests__/.gitkeep`                     | Historical test-directory placeholder.                                                                           | No runtime/test effect; the directory contains executable tests.                               |
| `src/modules/transactions/__tests__/history.cursor.test.js`       | Shared codec compatibility, URL-safe encoding and full microsecond round-trip.                                   | Cursor precision/format regressions lose their history entry-point check.                      |
| `src/modules/transactions/__tests__/history.schema.test.js`       | Bounds, types, dates, half-open ranges and malformed cursors.                                                    | Unvalidated filters or precision/limit assumptions lose direct checks.                         |
| `src/modules/transactions/__tests__/history.service.test.js`      | Owner account sets, masked viewer presentation, limit+1 and last-returned-row cursor.                            | Privacy/direction/pagination assembly regressions may be missed.                               |
| `src/modules/transactions/__tests__/transactions.schema.test.js`  | Deposit/withdraw body, UUID, integer bounds, description and extra-field stripping.                              | Invalid/mis-scaled movement requests lose the focused guard.                                   |
| `src/modules/transactions/__tests__/transactions.service.test.js` | Deposit/withdraw locking, status/funds/precision bounds, replay and rollback behavior.                           | Wrong operation order or inconsistent financial writes lose unit coverage.                     |
| `src/modules/transactions/__tests__/transfer.schema.test.js`      | Source UUID, recipient number, amount and description validation.                                                | Wrong destination/amount shape may no longer be caught.                                        |
| `src/modules/transactions/__tests__/transfer.service.test.js`     | Ordered locks, source ownership, destination concealment, funds/bounds and replay.                               | Deadlock-prone ordering, unauthorized debit or duplicate transfer loses direct service checks. |

### 9.17 Shared middleware and utility unit tests

| File                                                     | What it exercises                                                                               | Specific deletion / unsafe-edit risk                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/shared/middleware/__tests__/corsOptions.test.js`    | Closed production, permissive local behavior, exact allowlist and auth/key preflight headers.   | Browser-origin policy or retry-header exposure can regress unnoticed.        |
| `src/shared/middleware/__tests__/errorHandler.test.js`   | Sanitized 5xx and preserved expected client codes/details.                                      | SQL/internal error leakage or inconsistent client errors lose direct checks. |
| `src/shared/middleware/__tests__/frontend.test.js`       | Optional build, UI/HEAD routing, cache/CSP/nosniff, missing files/private paths/API isolation.  | Broad SPA fallback, cache bugs or hidden-path exposure may pass unnoticed.   |
| `src/shared/middleware/__tests__/idempotencyKey.test.js` | Required key and valid/invalid header formats.                                                  | Missing/repeated/malformed keys lose edge validation coverage.               |
| `src/shared/middleware/__tests__/validate.test.js`       | Cleaned body/params/query, defaults and errors, including Express 5 query-property replacement. | Raw query/input values may silently reach controllers.                       |
| `src/shared/utils/__tests__/AppError.test.js`            | Error defaults and explicit operational metadata.                                               | Status/code/details shape regressions lose direct tests.                     |
| `src/shared/utils/__tests__/calendar.test.js`            | Real/invalid calendar and leap/year edge cases.                                                 | Invalid dates reaching SQL or rejecting valid early years may be missed.     |
| `src/shared/utils/__tests__/logger.test.js`              | Real production Pino serialization removes credential headers but retains diagnostics.          | Silent test mode could hide a fresh production token/cookie leak.            |
| `src/shared/utils/__tests__/mask.test.js`                | Last-four masking, output length and short-input behavior.                                      | Counterparty/audit privacy regression loses a simple explicit guard.         |
| `src/shared/utils/__tests__/money.test.js`               | BIGINT-string conversion and safe-integer boundary rejection.                                   | Silent money precision loss may no longer be caught directly.                |

### 9.18 Integration and real-HTTP tests

These files use actual PostgreSQL or a guarded child-process HTTP fixture, rather than
proving SQL behavior solely with mocks. They must never target a valuable database.

| File                                          | What it exercises                                                                                                  | Specific deletion / unsafe-edit risk                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `tests/integration/accounts.test.js`          | Owner-scoped API create/list/detail, zero initial balance, mass-assignment denial and account ordering.            | Account privacy/creation regressions lose DB-backed proof.                                  |
| `tests/integration/audit.test.js`             | Real auth/money outcomes, refusal logging, actor/IP metadata, masking and sensitive-field exclusion.               | Audit behavior may diverge from unit mocks or leak sensitive request data.                  |
| `tests/integration/auditAdmin.test.js`        | Admin-only audit API, token role/promotion behavior, filtering/date/cursor rules and append-only enforcement.      | Audit disclosure/pagination/immutability assumptions lose integration coverage.             |
| `tests/integration/auth.login.test.js`        | Actual bcrypt login, JWT fields/expiry, normalized emails and generic failures.                                    | Invalid identity/token handling can escape real-DB checks.                                  |
| `tests/integration/auth.me.test.js`           | Safe current-user response, deleted users, invalid/expired tokens and current DB role.                             | Stale/deleted identity behavior loses end-to-end API coverage.                              |
| `tests/integration/auth.register.test.js`     | Stored hashes, duplicate-email race constraints, normalization, ignored role and JSON/body errors.                 | Plaintext/privilege/input/database behavior loses integration proof.                        |
| `tests/integration/db.transaction.test.js`    | Commit/rollback on real connections, SQL failure recovery and client release.                                      | The transaction helper could appear correct under mocks while leaking/partially committing. |
| `tests/integration/demo.verify.test.js`       | Public checker against a local real API: read-only business-table invariance and exact writable walkthrough state. | Verifier could secretly write in default mode or claim success on wrong balances.           |
| `tests/integration/health.test.js`            | Successful DB-backed health and uniform unknown-route 404.                                                         | Basic readiness/error routing loses its normal-path integration check.                      |
| `tests/integration/history.test.js`           | Real ledger history auth/ownership/presentation/filtering and microsecond/tie pagination behavior.                 | Query privacy or gaps/repeats may escape pure service tests.                                |
| `tests/integration/idempotency.test.js`       | Required keys, exact/changed replay, concurrent retries and no extra balance/ledger changes.                       | Duplicate-money races lose database-backed regression evidence.                             |
| `tests/integration/loan.applications.test.js` | Server-owned saved terms, per-user key races, owner concealment, bounds and no-funding behavior.                   | Application duplicates/privacy/snapshot regressions lose real constraint checks.            |
| `tests/integration/loan.reviews.test.js`      | Current-role enforcement, no self-review, terminal races/replay, review metadata and customer-visible reasons.     | Conflicting decisions or demoted-admin access may pass unit mocks.                          |
| `tests/integration/make-admin.cli.test.js`    | Actual operator child process, usage/missing user, persisted promotion/audit and failure exit/pool cleanup.        | CLI can hang, falsely report success or skip audit without detection.                       |
| `tests/integration/monitoring.alerts.test.js` | Admin/fresh-role API listing/detail, sanitized evidence, filters/date/keyset behavior.                             | Evidence disclosure or query/pagination errors lose DB-backed coverage.                     |
| `tests/integration/monitoring.test.js`        | Money/alerts atomicity, thresholds, replay exclusion, concurrency, bounded velocity windows and rollback failures. | Alert consistency could be weakened without a real-transaction failure test.                |
| `tests/integration/openapi.contract.test.js`  | Actual business-operation PostgreSQL responses/errors match published OpenAPI schemas.                             | Source/API documentation drift may go undetected despite structurally valid OpenAPI.        |
| `tests/integration/rateLimit.test.js`         | Real MemoryStore windows/keys/headers, disabling only in tests, proxy behavior and user/email isolation.           | Incorrect throttling, missing headers or spoofed client assumptions lose integration tests. |
| `tests/integration/schema.test.js`            | Real SQL checks/FKs/unique indexes, including direct invalid writes.                                               | API tests alone can miss weakened database backstops.                                       |
| `tests/integration/transactions.test.js`      | Real deposit/withdraw balances/ledger, ownership/status, precision/funds bounds and rollback.                      | Financial state changes may diverge from service mocks.                                     |
| `tests/integration/transfer.test.js`          | Cross/self-owned transfers, opposing/concurrent requests, atomic refusals, conservation and seeded reconciliation. | Lock-order/conservation/race regressions lose direct PostgreSQL evidence.                   |
| `tests/integration/verification.live.test.js` | Real TCP child server, saved terms/admin/money/alerts and malformed compressed-payload survivability.              | In-process Supertest may miss listener/parser/process-lifecycle failures.                   |

### 9.19 Test helpers, Docker verifier, and configuration tests

| File                                    | What it does/exercises                                                                                                      | Deletion / unsafe modification impact                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/helpers/auth.js`                 | Registers/logs in through Supertest and returns disposable identity/token fixtures.                                         | Dependant integration tests fail. Unsafe edit: fake/bypassed auth hides API regressions or fixtures use valuable identities.                                                        |
| `tests/helpers/db.js`                   | Test-only pool/fixtures, `_test` reset refusal, audit drain and explicit audit-table cleanup.                               | Most integration tests fail. Unsafe edit: destructive reset against wrong DB or asynchronous cross-test contamination.                                                              |
| `tests/helpers/ledger.js`               | Direct test ledger inserts and exact-microsecond timestamp fixtures.                                                        | History/audit-related fixtures fail. Unsafe edit: truncating timestamps hides paging bugs; direct SQL fixtures are not safe production endpoints.                                   |
| `tests/helpers/live-server.js`          | Guarded `_test` child HTTP server on an ephemeral localhost port with IPC readiness/cleanup.                                | Live verifier tests fail to start. Unsafe edit: wrong DB/listener target, leaked processes or test fixture exposed remotely.                                                        |
| `tests/docker/verify.js`                | Random owned image/project/volume/ports, image/privacy/bootstrap/API/website/restart/persistence checks and scoped cleanup. | `test:docker` and CI's image proof disappear/fail. Unsafe edit: shared-volume cleanup destroys data, missing isolation hides image defects or secret-bearing logs escape scrubbing. |
| `tests/unit/ci.config.test.js`          | Workflow triggers/permissions/pins/steps/timeouts/artifacts, dependency updates and frontend isolation.                     | CI can weaken while application tests remain green; keep config assertions synchronized with intentional changes.                                                                   |
| `tests/unit/docker.config.test.js`      | Docker stages/context/native/runtime settings, frontend dist-only copy, Compose profiles/readiness/security.                | Packaging/isolation changes can pass ordinary API tests until container build/runtime.                                                                                              |
| `tests/unit/portfolio.config.test.js`   | Private env ignore rules and explicit verifier not hidden in startup/test hooks.                                            | Secret-tracking or unexpected business-write startup hooks lose their guard.                                                                                                        |
| `tests/unit/render.config.test.js`      | Single Free service, private/generated secrets, CI trigger, bootstrap/health/proxy/pool settings.                           | Accidental resource/plan/security/startup drift may not be caught before deployment.                                                                                                |
| `tests/unit/render.startup.test.js`     | Real shell bootstrap with command stubs, PID exec/order, invalid Neon/TLS/host options and migration failure propagation.   | Bad TLS/host normalization, secret-bearing errors or starting after migration failure lose direct bootstrap checks.                                                                 |
| `scripts/__tests__/verify-demo.test.js` | Verifier argument/origin/write acknowledgements, fake network failures/privacy and no automatic remote mutation.            | Unsafe CLI defaults or credential-bearing failure output may ship.                                                                                                                  |

### 9.20 Documentation and historical reports

Deleting these files does not remove application features. It removes explanations/evidence,
and may leave README/other documentation links broken. Incorrect edits can be operationally
dangerous even though no JavaScript exception occurs.

| File                              | What it explains                                                                                          | Deletion / unsafe modification impact                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`            | Deployment trust boundaries, module/data diagrams, transfer sequence and failure lifecycle.               | Lose architectural map; stale diagram can misstate ownership, atomicity or frontend hosting.                  |
| `docs/day-15.md`                  | Historical quote/eligibility/amortization implementation and verification.                                | Lose Day 15 evidence; do not confuse its test count/scope with current completion.                            |
| `docs/day-16.md`                  | Historical pending application snapshots, retries and owner reads.                                        | Lose original application behavior/rationale record.                                                          |
| `docs/day-17.md`                  | Historical admin review, decision races, metadata and verification.                                       | Lose review-design context and evidence.                                                                      |
| `docs/day-18.md`                  | Historical monitoring rules, atomic evidence, list API and limits.                                        | Lose threshold/query/consistency rationale; changing prose alone does not change rules.                       |
| `docs/day-19.md`                  | Coverage design, measurement scope, operator/runtime failure tests and caveats.                           | Lose explanation of what the coverage metric actually measures.                                               |
| `docs/day-20.md`                  | OpenAPI/README and dependency-fix documentation stage.                                                    | Lose contract/documentation verification history.                                                             |
| `docs/day-21.md`                  | Docker/Compose design, isolation, persistence checks and production-log redaction finding.                | Lose packaging/security rationale; its pre-cloud status is historical.                                        |
| `docs/day-22.md`                  | Original two-job GitHub Actions setup, permission/pin/artifact decisions and local checks.                | Lose CI history; it must not override the current three-job workflow.                                         |
| `docs/day-23.md`                  | Render/Neon setup, private configuration, runbook and initial public persistence checks.                  | Lose cloud reconstruction/operational guidance; copying stale provider assumptions without review is risky.   |
| `docs/day-24.md`                  | Backend review, safer demo verifier, startup hardening and frontend handoff milestone.                    | Lose final backend-stage rationale and its distinction from the later UI commit.                              |
| `docs/demo.md`                    | Bounded portfolio walkthrough, read-only/writable verification and local admin options.                   | Lose reproducible demo instructions; careless changes can imply safe read-only use while writing remote data. |
| `docs/frontend-deployment.md`     | Actual public frontend commit/CI/Render evidence, browser results, disposable data and runner caveats.    | Lose deployment evidence or accidentally misrepresent local/public verification scope.                        |
| `docs/frontend-handoff.md`        | API/client invariants: same-origin config, tokens, paise, retry identity, permissions and error handling. | Lose cross-layer contract guidance; unsafe edits encourage an incompatible frontend.                          |
| `docs/frontend.md`                | Client run/test/scope/limits and same-service production serving details.                                 | Lose UI setup and no-network-preview/live-proxy distinction.                                                  |
| `docs/loan-design-decisions.md`   | Detailed quote/application/review decision, benefit, trade-off and failure-mode register.                 | Lose primary recorded loan rationale; not a substitute for actual service/schema code.                        |
| `docs/security-review.md`         | Point-in-time controls/findings, dependency decisions, provider checks and accepted demo risks.           | Lose review evidence; wrong edits can turn a bounded review into a false security certification.              |
| `docs/verification-days-15-19.md` | Scoped verification/parser advisory fix, independent schedule checks and explicit remaining gaps.         | Lose technical evidence; pre-deployment CORS/status statements remain historical.                             |

### 9.21 This handbook and its export

`docs/project-handbook.md` is the new maintained source of this handbook, added after the
228-file snapshot. Removing it does not stop the bank; it removes this consolidated learning
and maintenance reference and breaks any link to it. Unsafe edits mainly create inaccurate
operational/security guidance. Update it with code changes rather than treating it as a
permanent certification. A PDF export is a generated reading copy, not a runtime dependency.

## 10. Generated, private, and machine-local files

“Every file” in a project is not the same as every third-party/cache file on one machine.
The complete maintained-source list is above. These important local/runtime categories
have different ownership and deletion risks; private contents are intentionally not inspected
or reproduced in this handbook.

| Path/category                                                                     | Purpose                                                             | Removal/modification consequence                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`, private `.env.*` files                                                    | Local private runtime configuration                                 | Local API/commands need equivalent injected variables if removed. Never commit/share values; cloud runtime has separate private settings.                                  |
| `frontend/.env.local` or other private client variants                            | Optional public browser/local proxy settings                        | Local build/proxy selection changes. Never put cloud/database/JWT secrets in a Vite env file.                                                                              |
| `node_modules/`                                                                   | Installed backend third-party packages/tool binaries                | Local API/tests/commands need `npm ci` again. Deleting local copies does not change the already-deployed image. Do not hand-edit dependency code as the maintained fix.    |
| `frontend/node_modules/`                                                          | Installed frontend/build/browser-test packages                      | UI commands need `npm --prefix frontend ci` again. Locked manifests, not this generated tree, define maintained dependencies.                                              |
| `coverage/`                                                                       | Generated backend HTML/JSON/LCOV coverage reports                   | Removes reports, not implementation/tests; regenerate with the test command. Review scope before quoting percentages.                                                      |
| `frontend/dist/`                                                                  | Generated local production HTML/assets/fonts/licenses               | Regenerate with build. Docker builds its own dist; deleting local dist does not delete cloud assets. Editing it directly is overwritten on the next build.                 |
| Runtime `/app/public/`                                                            | Compiled frontend copied into a built container                     | Removing it inside a live runtime can break UI/assets; API may remain available. Not the same as deleting a local source `frontend/public` file.                           |
| `frontend/*.tsbuildinfo`                                                          | Optional compiler incremental state                                 | Recreated by typechecking/build when used; no business data.                                                                                                               |
| `frontend/artifacts/`                                                             | Generated ignored design/public screenshots                         | Removal loses visual evidence, not banking state. Do not publish authenticated/sensitive screenshots.                                                                      |
| `frontend/test-results/`, `frontend/playwright-report/`                           | Browser test results/failure traces/reports                         | Removal loses diagnostics. Traces can contain credentials/data if captured from non-disposable flows.                                                                      |
| Docker image/build cache                                                          | Compiled environment and build layers                               | Removing an unused local image/cache requires rebuilding/pulling later. Removing a running deployment/container is an availability operation, not harmless source cleanup. |
| Local Docker `pgdata` volume                                                      | Actual local PostgreSQL files                                       | Removing it destroys that local database unless restored from backup. Normal Compose `down` deliberately retains it.                                                       |
| Neon project/database/branches                                                    | Hosted business schema/rows and migration history                   | Deletion or bad SQL can immediately lose hosted data/break API. A Git clone is not a database backup.                                                                      |
| Render service/private environment                                                | Hosted runtime/build/deploy configuration                           | Deleting service or changing secrets/target DB affects availability/auth/data access; closing its dashboard tab does not.                                                  |
| `.git/`                                                                           | Commit history, refs, index and repository metadata                 | Removing it loses local Git context/history access; source/cloud copies are separate. Never edit internals as application configuration.                                   |
| Other ignored scratch/editor files, including a local `pwd/` directory if present | Not part of the 228-file maintained snapshot or runtime COPY inputs | No source dependency was established here. Inspect ownership/purpose before removal; this handbook does not authorize deleting unfamiliar user files.                      |

The dependency lockfiles describe the resolved third-party graph; this handbook does not
claim to audit or explain every internal vendor file. Review licenses and security advisories
when changing that graph.

## 11. Glossary and maintaining this handbook

| Term             | Meaning here                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Atomic           | A database transaction commits all coordinated writes or none; not a claim that every external effect/audit is included. |
| Idempotency      | Retrying a matching persisted intent/key does not create a second business write. A new key is a new intent.             |
| Row lock         | Database serialization point preventing conflicting updates from acting on the same unlocked balance.                    |
| Lock order       | A shared ordering for acquiring multiple locks, reducing opposing-transfer deadlocks.                                    |
| Paise            | Integer hundredths of an Indian rupee; the API monetary unit.                                                            |
| Safe integer     | JavaScript number that can represent the integer exactly; not every PostgreSQL BIGINT fits.                              |
| Basis point      | One hundredth of one percent; 1200 bps is 12%, not 1200%.                                                                |
| EMI              | Equated monthly installment; the final rounded payment can differ to settle the remaining debt.                          |
| Snapshot         | Saved quote terms/schedule, not a calculation rerun under today's rules.                                                 |
| Keyset cursor    | A position based on ordered row values, not a page offset or access credential.                                          |
| IDOR             | Accessing another user's object by identifier because owner authorization was omitted.                                   |
| JWT              | Signed bearer identity/role claims; copying a valid token can confer its authority until it stops being accepted.        |
| CORS             | Browser cross-origin response-access policy, not server authorization or a network firewall.                             |
| CSP              | Browser content security policy limiting resource/script behavior; not a complete XSS prevention system by itself.       |
| SPA              | Client-side routed application; direct URL reloads also need the server's correct HTML fallback.                         |
| CI vs deployment | CI tests/builds; Render separately deploys the selected commit after its gate.                                           |
| Migration        | Ordered schema evolution recorded by a DB tool; not a source-file reload or database backup.                             |
| Cold start       | Delay when an idle free runtime/DB compute resumes; does not mean your local terminal is required.                       |
| Regression       | A change breaks previously intended behavior, often without a syntax error.                                              |

### 11.1 Evidence map

- **Primary implementation:** the files named in section 9, especially transaction service/
  repositories, migrations, `useSafeWrite`, deployment bootstrap, and workflow.
- **Recorded rationale:** [loan decisions](loan-design-decisions.md), [architecture](architecture.md),
  [Docker milestone](day-21.md), [CI milestone](day-22.md), [cloud setup](day-23.md),
  [backend review](day-24.md), and [frontend guide](frontend.md).
- **Security/verification boundaries:** [security review](security-review.md),
  [earlier verification](verification-days-15-19.md), and
  [public frontend deployment](frontend-deployment.md).
- **Hands-on entry points:** [root README](../README.md), [demo walkthrough](demo.md),
  [frontend package README](../frontend/README.md), and the public API contract.

### 11.2 Keep the document synchronized

When adding/removing a maintained file, update the inventory and check it against
`git ls-files`. When changing money/permissions/contract/deployment behavior, update the
relevant decision, limitation, coupled-change row, and tests—not just a file description.
When reporting verification, record the exact commit, scope and date; do not silently reuse
old counts or a green run from a different version.

This document is a learning and change-impact map. It is not permission to disable guards,
reset data, publish secrets, upgrade paid resources, or make production changes without an
explicitly scoped decision.
