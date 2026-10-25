# Verification pass: Days 15–19

Scope: source review of loan arithmetic, application ownership/idempotency, admin decisions,
monitoring atomicity/window queries, migrations, dependency audit and the coverage gate.
This is a focused engineering verification, **not an independent penetration test or
certification that no critical bug exists**.

## Finding fixed before proceeding

`npm audit --omit=dev` found one **high-severity** advisory in the locked `body-parser`
2.3.0 dependency used by Express: **GHSA-27r3-jxmh-p828 / CVE-2026-111181**. Trailing
bytes after a compressed request could cause an uncaught decompressor error and terminate
the process before authentication/routing.

The compatible lockfile update installs **body-parser 2.4.0** and **raw-body 3.0.2**.
No Express major-version change or blanket `npm audit fix --force` was used. Both full
and production-only npm audits then reported zero known advisories. These are point-in-time
registry results, not a guarantee against unknown vulnerabilities.

Reference: https://github.com/advisories/GHSA-27r3-jxmh-p828

## Checks completed before Day 20

- **894 tests across 59 suites passed**, with the global coverage gate intact.
- Real HTTP checks run the actual Express app in a separate Node process bound to an
  ephemeral localhost port, against the PostgreSQL test database. They register/login,
  submit concurrent application retries, refuse another owner's access, review/replay,
  move funds, reconcile balances, read alerts and refuse stale admin roles.
- Malformed gzip and deflate payloads with trailing bytes are sent over real TCP. A new
  health request must still succeed afterward, proving the patched process stays alive.
- **200 seeded loan schedules** (seed 20261025, annual rate 1200 bps, supported principal/
  tenure ranges) matched an independent Python Decimal implementation at 100-digit
  precision, including every installment, interest rounding, final balance and totals.
  Python was used for this one-off independent check, not added as an npm test dependency.
- All **five migrations** applied successfully to a newly created, isolated `_test`
  database. Review columns and alert table were checked; that temporary database was
  removed afterward. Development data/schema were not modified by this check.
- Existing tests rechecked competing reviews, same/distinct-key transfer concurrency,
  rollback after a second alert fails, database constraints, admin demotion, sensitive
  metadata exclusion and microsecond cursor ordering.

No additional critical application-logic defect was identified in this scoped review.
The dependency finding demonstrates why high test coverage alone was insufficient.

## Known risks not misrepresented as fixed

Self-declared income/debt and missing exposure/funding/repayment controls are explicit demo
limits. Audit delivery remains best-effort; the audit-list route trusts JWT roles until
expiry. A fresh role check on review/alerts is not atomic with in-flight demotion. Shutdown
is not a durable audit-drain protocol. Rate limits are single-process; CORS is open.
Privileged SQL can alter application/alert records, and the make-admin role/audit writes
are not one atomic transaction. These require production design work, not merely more tests.

Result: the focused checks passed **after fixing the dependency**, allowing Day 20's
documentation work to begin. Continued regression testing and dependency review remain
necessary. No automatic commit/push was performed.
