# Day 17: admin loan review (no disbursement)

## API and workflow

All routes are under `/api/v1`. New admin routes require both an admin JWT and a fresh
database lookup confirming the caller is still an admin.

- `GET /admin/loan-applications/:id`: inspect an application and its saved terms.
- `POST /admin/loan-applications/:id/review`: make one terminal decision:

```json
{
  "decision": "approved",
  "reason": "Income documents reviewed"
}
```

`decision` must be `approved` or `rejected`. The trimmed reason must contain 10–500
Unicode characters and is **visible to the applicant**, not a private admin note.
Do not put secrets in it. Unsupported PostgreSQL text (null bytes/lone surrogates)
is rejected before SQL. The example is illustrative, not evidence that verification exists.

The state machine is `pending -> approved` or `pending -> rejected`. No API transition
back to pending or between final states exists. An admin cannot review their own
application. Anyone with admin privileges may otherwise review; there is no assignment queue.

Success returns `200 { application }`. The owner can still retrieve their own application
through the existing customer endpoint. A new `review` response field is null while pending,
or `{ reason, reviewedAt }` afterward. Reviewer identity is stored in the database/audit
trail, not exposed as a staff UUID in the customer response. The admin detail route also
uses this presentation; operational reviewer lookup is through the audit log/database.

Identical retries by the same reviewer return the recorded result and timestamp with
`Idempotent-Replayed: true`. They need no `Idempotency-Key`: the application id plus its
one-way state transition bounds the operation. A different decision, reason or reviewer
after completion returns `409 LOAN_ALREADY_REVIEWED` instead of overwriting history.

Other errors: missing/invalid credentials 401; non-admin/demoted admin 403; self-review
403 `SELF_REVIEW_FORBIDDEN`; bad body/path 400; missing application 404. Authenticated
non-admin POST attempts are audited before the role guard rejects them. Requests stopped
by authentication or the whole-API limiter are outside that route audit hook.

## Concurrency, role checks and audit

The write is one conditional SQL statement: `UPDATE ... WHERE status = 'pending'`.
PostgreSQL serializes updates to the row and rechecks the condition after waiting.
Only one decision wins. Losing callers read the result in a subsequent READ COMMITTED
statement and either replay it or get 409. There is no read-then-unconditional-write race.
No explicit multi-statement transaction is needed for this single state-changing write.

Role lookup happens before application access on both new endpoints. It rejects a stale
admin JWT after demotion has committed, unlike the existing audit-list route which still
trusts the token role. It is NOT atomic with review: demotion of an already-in-flight request
can race after the lookup. Locking/versioning auth and decisions together would be needed
for stronger revocation semantics. Newly promoted users still need a new admin JWT.

Audit action `loan.review` keeps only the decision and bounded `resourceId` path parameter,
never the reason, income or debt. Route parameters must be captured when middleware runs:
Express restores them while an error unwinds the router, before `finish`. An integration
test caught missing target ids in refused-review logs; capturing them early fixed it.
Audit writes remain best-effort after the response, not part of the approval update.

## Database and files

Migration `1792972800000_loan-review.sql` expands status values and adds reviewer, reason
and timestamp. A CHECK requires all review fields to be absent for pending rows and
present for decisions, with a non-self reviewer and bounded reason. A foreign key keeps
the reviewer valid, but does not require their role to remain admin forever. These checks
enforce row shape, not immutable history against direct SQL: privileged operators can still
alter valid rows. API terminality is enforced by the conditional update and service.

The down migration refuses to erase existing decisions. Tests exercise both successful
pending-only rollback and refusal after review, inside transactions that are rolled back
so the test schema remains at the current version.

| File                                            | Responsibility                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `src/modules/loans/adminApplications.routes.js` | JWT auth, role guard, audit hook, body/path validation.            |
| `src/modules/loans/reviews.service.js`          | Current admin role, no self-review, state rules, retry comparison. |
| `src/modules/loans/reviews.controller.js`       | HTTP status and replay header.                                     |
| `src/modules/loans/applications.repository.js`  | Admin-only lookup, conditional SQL update, safe presentation.      |
| `src/modules/loans/loans.schema.js`             | Valid decisions and PostgreSQL-compatible reason validation.       |
| `src/modules/audit/audit.actions.js`            | New action and privacy whitelist.                                  |
| `src/modules/audit/audit.middleware.js`         | Optional bounded resource-id capture before router unwinds.        |
| `src/modules/index.js`                          | Mount new admin router.                                            |

## Explicit non-goals

Approval is a demo workflow decision, **not disbursement**. It does not create ledger rows,
change balances, verify income, track outstanding principal, enforce aggregate exposure,
recompute saved terms, or schedule collections. Multiple approved applications remain
possible; no real underwriting claim should be made. Disbursement would need separate
authorization, funding/ledger rules, idempotency, atomic balance updates and repayment design.

There is still no application listing endpoint. Admins must know the application id.
There is no appeal/reopen/edit endpoint or second-person approval of the review itself.
The existing whole-API rate limit applies; there is no review-specific limiter.

## Run and verify

```sh
npm test
npm run lint
```

`npm test` migrates only the test database. Before using the new endpoints against the
development database, run `npm run migrate -- up`; that database is not migrated by this work.
No separate dev server is needed for the automated Supertest HTTP checks.

Verified on macOS with real PostgreSQL: **46 suites, 783 tests passed** (65 added since
Day 16), with ESLint and `git diff --check` clean. The migration applied successfully
to the test database. Both rollback paths were tested without downgrading the persistent
test schema. Development migration, manual curl testing, commit and push were not performed.

See `docs/loan-design-decisions.md` for the combined Days 15–17 decisions, trade-offs
and failure modes.
