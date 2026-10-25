# Architecture

An educational **modular monolith**, not microservices, a payment processor or a full
double-entry general ledger. One Node.js process serves all API modules. PostgreSQL is
the source of truth; no browser may connect to it directly.

## Deployment and trust boundaries

```mermaid
flowchart LR
  Client[Swagger / HTTP client] -->|HTTPS + bearer JWT| Edge[Render managed edge]
  Edge -->|one trusted app-facing proxy hop| API[Express 5 / Node 22 container]
  API -->|direct PostgreSQL + verified TLS| DB[(Neon PostgreSQL 16)]
  Git[GitHub main] --> CI[Tests + coverage + lint + audit]
  CI --> Docker[Isolated Docker verification]
  Docker -->|checks pass| Build[Render build and startup migrations]
  Build --> API
  Secrets[Render private environment] --> API
```

Render hosts a free Singapore web service; Neon hosts a separate free Singapore project.
The runtime is non-root. The local Compose runtime additionally enforces a read-only
filesystem/dropped capabilities; those Compose controls must **not** be assumed to be
Render's container settings. The image excludes `.env`, source tests, host dependencies
and Git history. The bootstrap validates configuration, applies migrations on a direct
connection, then `exec`s Node. Database credentials/JWT signing secret are private runtime
configuration, not frontend configuration or build artifacts.

`TRUST_PROXY=1` assumes Render's app-facing topology; adding another proxy/CDN requires
review. CORS denies unlisted browser origins in production, but is not authentication or
a firewall. Same-origin Swagger is public and sends real requests. Limits are per process;
there is no shared Redis limiter or cross-instance coordination.

## Request and module boundaries

```mermaid
flowchart TD
  HTTP[Express + Helmet + CORS + body limit + HTTP logging]
  HTTP --> Routes[Module routes: auth / accounts / transactions / loans / audit / monitoring]
  Routes --> Guards[JWT / role / rate limit / Zod validation]
  Guards --> Controller[Controller: HTTP mapping]
  Controller --> Service[Service: business rules and orchestration]
  Service --> Repository[Repositories: parameterized SQL]
  Repository --> Pool[pg Pool / one client per transaction]
  Pool --> Postgres[(PostgreSQL)]
  Routes -. response finish .-> Audit[Best-effort audit service]
  Audit --> Repository
```

The exact middleware order is route-specific (for example, audit hooks wrap limiter and
validation failures). `src/modules/index.js` composes routes; `src/app.js` configures the
application; `src/server.js` owns listening/signals/shutdown. Modules expose services and
repository operations rather than letting controllers issue SQL. Deliberate exceptions
are operator scripts, migrations, database health queries and test fixtures.

| Module       | Responsibility                                   | Important boundary                                               |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------- |
| auth         | Register/login, bcrypt, HS256 JWT, current user  | Signing secret never leaves the API; role grant is operator-only |
| accounts     | Account creation and owner-scoped reads/locks    | An unrelated account looks absent (404)                          |
| transactions | Deposits, withdrawals, transfers and history     | One DB transaction for balances, ledger and monitoring           |
| loans        | Exact quote, saved applications and admin review | Approval is a decision, not disbursement; no self-review         |
| audit        | Selected request outcomes and admin listing      | Post-response writes, append-only trigger, not durable delivery  |
| monitoring   | Large-transaction/rapid-transfer alerts          | Writes share the money transaction; admin-only reads             |

## Database schema

```mermaid
erDiagram
  USERS ||--o{ ACCOUNTS : owns
  ACCOUNTS o|--o{ TRANSACTIONS : source
  ACCOUNTS o|--o{ TRANSACTIONS : destination
  USERS ||--o{ LOAN_APPLICATIONS : submits
  USERS o|--o{ LOAN_APPLICATIONS : reviews
  TRANSACTIONS ||--o{ MONITORING_ALERTS : flags
  ACCOUNTS ||--o{ MONITORING_ALERTS : concerns
  USERS {
    uuid id PK
    text email UK
    text full_name
    text password_hash
    text role
  }
  ACCOUNTS {
    uuid id PK
    uuid user_id FK
    text account_number UK
    text type
    bigint balance
    text status
  }
  TRANSACTIONS {
    uuid id PK
    text type
    uuid from_account_id FK
    uuid to_account_id FK
    bigint amount
    text idempotency_key
  }
  LOAN_APPLICATIONS {
    uuid id PK
    uuid user_id FK
    bigint principal
    integer tenure_months
    bigint monthly_income
    bigint existing_monthly_emi
    jsonb quote
    text status
    text idempotency_key
    uuid reviewed_by FK
    text review_reason
    timestamptz reviewed_at
  }
  MONITORING_ALERTS {
    uuid id PK
    uuid transaction_id FK
    uuid account_id FK
    text rule_code
    text severity
    jsonb details
  }
  AUDIT_LOGS {
    uuid id PK
    uuid user_id
    text action
    text outcome
    integer status_code
    text ip_address
    jsonb metadata
    timestamptz created_at
  }
```

Diagram fields are abbreviated; the five SQL migrations are authoritative. `audit_logs.user_id`
is deliberately **not** a foreign key, so historical audit entries do not depend on a
user's continued existence. `pgmigrations` is migrator bookkeeping, not a business table.

Money is integer paise in `BIGINT`, converted to JSON numbers only within JavaScript's
safe-integer range. Database checks enforce nonnegative balances, positive amounts and
valid deposit/withdrawal/transfer shapes. Unique keys enforce:

- Case-insensitive user emails and unique account numbers.
- Transaction retries scoped by `(COALESCE(from_account_id, to_account_id), idempotency_key)`.
- Application retries scoped by `(user_id, idempotency_key)`.
- At most one alert per transaction/rule pair.

Application quotes are stored JSONB snapshots. Reviews conditionally update a pending
row, enforce a different reviewer/applicant, and keep a customer-visible reason. Audit
row update/delete is blocked by a trigger, but a privileged DB operator can bypass it.

## Transfer: atomicity and retry safety

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Transaction service
  participant R as Repositories
  participant P as PostgreSQL client
  C->>S: Validated transfer + user + Idempotency-Key
  S->>P: BEGIN (one checked-out connection)
  S->>R: Resolve destination account number
  S->>R: Lock both accounts in ascending ID order
  R->>P: SELECT FOR UPDATE (source is owner-scoped)
  S->>R: Look up prior key on source account
  alt Matching completed request exists
    S->>P: COMMIT without another movement
    S-->>C: Original transaction + current account + replay header
  else New request
    S->>S: Active accounts, sufficient funds, safe bounds
    S->>R: Debit, credit, insert ledger row, record monitoring
    R->>P: All statements use the same transaction client
    S->>P: COMMIT
    S-->>C: 201 (only after commit)
  end
  Note over S,P: Any failure rolls back; client is released in finally
```

Sorting locks reduces opposite-direction transfer deadlocks. Ownership precedes replay;
replay precedes current business-state checks. Reusing a key for changed normalized input
returns 422. A transfer has one transaction row referenced from both accounts; this is
not a full accounting ledger with independently balanced debit/credit postings.

History uses opaque keyset cursors with microsecond timestamps and UUID tie-breakers.
Counterparty account numbers are masked. Offset pagination and browser date reformatting
must not be substituted for those cursors.

## Failure and lifecycle boundaries

- SQL/money/monitoring failure: roll back the whole money movement, not partial balances.
- Audit delivery failure: log it, do not rewrite a successful response; crash loss remains.
- SIGTERM: stop accepting HTTP, drain pending audit writes, end the pool, exit. A hard
  provider deadline can still interrupt cleanup.
- Idle managed DB disconnect: handle the pool error; do not blindly retry a money write.
- Bad environment or migration: Render startup fails before HTTP. Applied migrations are
  skipped on restart. Code rollback does not automatically reverse schema/data changes.
- Free-tier sleep/quota: availability may be delayed; no SLA, HA or verified backup/restore
  guarantee. The project is for disposable demonstration data only.

See [security review](security-review.md), [demo walkthrough](demo.md) and
[deployment runbook](day-23.md) for evidence and accepted limitations.
