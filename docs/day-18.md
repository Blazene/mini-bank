# Day 18: transaction monitoring and admin alerts

## Scope

New successful API deposits, withdrawals and transfers are evaluated for two **demo**
rules. These are explainable heuristics, not proof of fraud, regulatory thresholds or
production AML controls. Alerts do not block a movement, freeze accounts or notify a
customer. There is no historical backfill or background scanner in this increment.

| Rule                | Trigger                                                                                             | Severity | Subject                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `LARGE_TRANSACTION` | Amount **at least 10000000 paise** (Rs 1 lakh)                                                      | medium   | Deposit destination, or withdrawal/transfer source |
| `RAPID_TRANSFERS`   | Current transfer plus at least four other completed outgoing transfers in the previous five minutes | high     | Transfer source                                    |

A transfer may produce both alerts. The fifth and every later qualifying transfer
produces its own velocity alert; there is no burst-level suppression/cooldown. Severity
is a fixed demo label, not a calculated risk score. Detection is per account, not across
all accounts belonging to a person. Incoming transfers, deposits, withdrawals, refused
requests, pending/failed ledger rows, old rows and future-dated rows do not count toward
outgoing velocity.

## Atomic integration and retries

`transactions.service.js` calls monitoring **after inserting a new ledger row**, before
commit, while the existing account locks are still held. It passes the same PostgreSQL
client for all velocity queries and alert inserts. Monitoring does not acquire account
locks or alter the existing lowest-id-first transfer lock order.

This gives all-or-nothing balance, ledger and alert writes. An alert/count database error
propagates and **rolls back the money movement**, even if a first alert already succeeded.
This is an explicit availability trade-off: synchronous monitoring must be healthy for
new movements. It is not best-effort logging. A future transactional outbox could decouple
evaluation while guaranteeing eventual processing; simply swallowing errors would lose alerts.

Idempotent replays return before monitoring. They neither add velocity nor retroactively
flag an older transaction after later transfers. A database unique constraint on
`(transaction_id, rule_code)` is an additional duplicate backstop, not a replacement for
the replay guard. Re-evaluating an existing alert cannot overwrite its original details.

The source account lock serializes concurrent outgoing transfers. Under default READ
COMMITTED isolation, each evaluation sees earlier committed transfers plus its current
transfer. Its query checks at most four other qualifying rows, using the existing
`transactions_from_idx`; evidence says **countAtLeast: 5**, not a fabricated exact total.
The window uses PostgreSQL `statement_timestamp()`, includes its lower and upper bounds,
and does not rely on the app server clock.

The current transfer is counted separately, so even an unusually long-running transaction
counts itself once. New API ledger inserts now explicitly use `clock_timestamp()` for
`created_at` rather than transaction-start `now()`: waiting on account locks should not
make a newly inserted movement look old. Existing rows are not rewritten; direct SQL
inserts still follow their table default and bypass service monitoring entirely.

## Admin API

All paths are under `/api/v1`:

- `GET /admin/alerts`: filtered, newest-first keyset pagination.
- `GET /admin/alerts/:id`: one alert; missing ids return `404 ALERT_NOT_FOUND`.

Both routes require an admin JWT **and** a fresh database admin-role check, as in Day 17.
An already-authorized in-flight request can still race a demotion; the role check is not
locked together with reads. Other users receive 403 before filter/id validation, absent
or invalid tokens receive 401, and invalid queries/ids receive 400. Newly promoted users
must obtain a new JWT. Only admins can access alert/account/transaction ids through these
endpoints; the normal customer transaction responses are unchanged.

Filters:

- `ruleCode`: `LARGE_TRANSACTION` or `RAPID_TRANSFERS`
- `severity`: `medium` or `high`
- `accountId`, `transactionId`: UUIDs
- `from`, `to`: zoned ISO timestamps, inclusive `from`, exclusive `to`
- `limit`: default 20, maximum 100; invalid limits are refused, not clamped
- `cursor`: opaque continuation token; repeat your filters when requesting subsequent pages

Example: `GET /api/v1/admin/alerts?ruleCode=RAPID_TRANSFERS&limit=20`.

Response: `{ alerts, pagination: { limit, hasMore, nextCursor } }`. Each alert has `id`,
`transactionId`, `accountId`, `ruleCode`, `severity`, `details`, `createdAt`. Detail returns
`{ alert }`. Details contain only rule-generated numeric evidence and `ruleVersion: 1`;
no account numbers, descriptions, income or request bodies are copied.

Pagination orders by `created_at DESC, id DESC` and preserves all six PostgreSQL
microsecond digits in cursors. Display timestamps still use the existing millisecond
JSON convention; cursor timestamps are internal. There is no total count or page number.

With a third paginated endpoint, common date/limit/cursor validation has moved to
`src/shared/validation/pagination.schema.js`, and the codec to
`src/shared/utils/pagination.cursor.js`. History entry points still re-export their old
interfaces so existing callers/tests continue working. Audit imports shared helpers
directly instead of depending on the transactions module for pagination.

## Database and architecture

Migration `1793059200000_monitoring-alerts.sql` adds `monitoring_alerts`, with transaction
and account foreign keys, bounded rule/severity values, JSON-object evidence and per-rule
transaction uniqueness. Indexes support newest-first listing, account and rule filters.
Severity/transaction filters may use other indexes plus filtering; no index is claimed
for every possible combination.

The down migration refuses to erase existing alerts. Alerts have no public update/delete
API, but unlike `audit_logs`, this table is **not protected by an append-only trigger**:
privileged SQL can still change evidence. Foreign keys link alert lifecycle to ledger/
accounts and may restrict deletion. The existing guarded test reset clears alerts through
the user -> accounts/transactions foreign-key chain.

Module boundaries remain intact: only the transactions repository queries the ledger for
velocity; monitoring's repository owns its own table. Pure rules live separately from SQL,
HTTP controllers and admin access checks. The existing whole-API limiter applies; there
is no alert-read-specific limiter. Read requests are not added to the request audit log,
consistent with the existing history and admin read endpoints.

| File                                               | Responsibility / failure risk                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/modules/monitoring/monitoring.rules.js`       | Thresholds/evidence; wrong comparisons miss boundaries or overflag.                                        |
| `monitoring.service.js`                            | Same-client evaluation and fresh admin authorization; swallowing failures loses atomic alerts.             |
| `monitoring.repository.js`                         | Deduplicated inserts and paginated reads; wrong uniqueness/ordering duplicates or skips alerts.            |
| `monitoring.schema.js`                             | Bounded filters; unvalidated cursor/date input can cause SQL errors.                                       |
| `monitoring.controller.js`, `monitoring.routes.js` | HTTP presentation and auth-before-validation.                                                              |
| `src/modules/transactions/transactions.service.js` | Hook only new movements, before commit; moving it outside breaks atomicity.                                |
| `transactions.repository.js`                       | Bounded ledger-window query and insertion-time timestamps; omitting status/source/time filters overcounts. |
| Shared pagination helpers                          | Used by all three lists; changes must preserve history and audit behavior too.                             |

## Verification and running

Verified on macOS with real PostgreSQL: **51 suites, 867 tests passed** (84 new tests
since Day 17). ESLint and `git diff --check` passed. The alert migration applied to the
test database successfully; the development database was not migrated by this work.

```sh
npm test
npm run lint
```

Tests cover threshold boundaries, transfer bursts, concurrent distinct/same-key requests,
retroactive replay refusal, rollback after the second alert fails, uncommitted same-client
visibility, ignored old/future/failed/incoming rows, database constraints, fresh admin access,
filter combinations and pagination across microsecond ties/new inserts. Existing transfer,
history, audit and loan suites are rerun as regression checks.

To use the API in development, start PostgreSQL and apply the migration there separately:

```sh
npm run migrate -- up
npm run dev
```

`npm test` migrates only the test database. This work does not automatically migrate
development, start a development server, commit or push.

## Remaining work

No alert acknowledgement/resolution workflow, notifications, cross-account profiling,
retention/backfill, production threshold calibration or outbox worker exists yet. These
are separate follow-ups rather than hidden guarantees. Next focus on coverage review,
OpenAPI/README, Docker/CI, deployment and final polish from the original roadmap.
