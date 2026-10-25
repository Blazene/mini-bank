# Day 16: pending loan applications

Day 15 is committed as `e3a906e`. Day 16 adds durable applications on top of its quote
calculator, without any approval or money movement.

## API

- `POST /api/v1/loans/applications`: Bearer token, `Idempotency-Key` and the same JSON
  body as `/loans/quote`. Returns `201 { application }`. Eligibility is recalculated
  by the server; ineligible attempts return `422 LOAN_INELIGIBLE` and save nothing.
- `GET /api/v1/loans/applications/:id`: returns `200 { application }` for the owner only.
  Missing and unowned ids return identical `404 LOAN_APPLICATION_NOT_FOUND` responses.
  Even admins cannot use this customer endpoint to read another person's application.

The application includes its id, principal, tenure, declared income/debt, pending status,
creation time and the saved full quote. These are sensitive owner-only records.
Unknown fields (owner, status, rate, eligibility) are ignored; only server terms are saved.
The unchanged Day 15 quote endpoint remains read-only.

## Retry and storage rules

- A unique `(user_id, idempotency_key)` constraint protects concurrent submissions.
  Same-key identical retries return the saved application with `Idempotent-Replayed: true`.
- A changed principal, tenure, income or existing EMI with the same key returns
  `422 IDEMPOTENCY_KEY_REUSED`. Omitted existing EMI and explicit zero are equivalent.
- Replays return saved terms before recalculating eligibility. Future policy changes
  must not silently rewrite an existing application.
- Refused applications do not reserve their key. Corrected input may reuse it.
- Different keys can create multiple applications; this is NOT an outstanding-loan limit.
- An insert with `ON CONFLICT DO NOTHING` waits for the winning insert. A separate
  statement then reads it under PostgreSQL's default READ COMMITTED isolation.
  No balance locks or multi-write transaction is needed: there is one application write.

Migration `1792886400000_loan-applications.sql` adds typed money fields, bounds, a user
foreign key, pending-only status, a JSONB quote snapshot and per-user indexes/uniqueness.
The existing guarded test reset reaches this table through the user foreign key.
The migration is applied to the test database by `npm test`; apply it to development with
`npm run migrate -- up` before using the new endpoints there.

`applications.repository.js` owns SQL, `applications.service.js` owns eligibility/replay
rules, and `applications.controller.js` owns HTTP responses. The existing loan router
authenticates before validation and uses the shared idempotency middleware.

Audit action `loan.apply` records successful and refused authenticated submission attempts.
Only principal and tenure are whitelisted: income, debt, quote schedules and retry keys
are not copied into audit metadata. Existing best-effort, post-response audit limitations
still apply. Read requests are not audited, consistent with account/history reads.

## Deliberate limits and next steps

This is an educational application, not a binding offer or approval. Income and existing
debt remain self-declared. There is no listing endpoint yet, credit bureau check, income
verification, approval/rejection workflow, disbursement, repayment, outstanding debt tracking
or balance change. Pending status is the only database-supported status in this increment;
introducing transitions needs a migration and an explicit reviewed policy.

Next agree approval/rejection and funding rules, including how multiple applications and
existing debts are evaluated. Do not simply credit an account on application creation.
Then resume monitoring/alerts, coverage, OpenAPI/README, Docker/CI and deployment.

## Verification

```sh
npm test
npm run lint
```

New tests cover ownership, validation, saved terms, eligibility, safe retries, conflicting
concurrent submissions, database constraints, audit privacy and unchanged balances/ledger.

Verified on macOS against the PostgreSQL test database: **43 suites, 718 tests passed**
(40 tests added since Day 15). ESLint and `git diff --check` also passed. The test-database
migration was applied successfully; the development database was not migrated here.
