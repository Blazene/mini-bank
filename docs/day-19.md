# Day 19: coverage review and regression gate

Day 18 was committed and pushed as `d0698c1`. Day 19 focuses on verification rather
than adding banking features. No business logic, database schema or dependencies changed.

## Results

Verified on macOS with the real PostgreSQL test database:

```text
Test Suites: 58 passed, 58 total
Tests:       890 passed, 890 total
```

This adds **23 tests** to Day 18's 867 across seven new suites and focused additions to
existing suites. ESLint and `git diff --check` pass.

| Instrumented scope           | Statements | Branches | Functions | Lines  |
| ---------------------------- | ---------- | -------- | --------- | ------ |
| All application `src/` files | 100%       | 100%     | 100%      | 100%   |
| `src/` plus `scripts/`       | 98.34%     | 98.57%   | 98.21%    | 98.20% |

The initial Day 19 measurement was **98.27% lines for src only**, before adding tests.
The final overall figure includes the operator script as well, so comparing 98.27% with
98.20% as though they used the same denominator would be misleading.

`scripts/make-admin.js` remains 37.5% line coverage in Jest's in-process report. Its
exported grant operation is covered by existing integration tests. New real CLI tests
exercise success, missing arguments, unknown users and database connection failure in
child processes. Jest's Babel instrumentation does not merge those child-process
executions into its coverage counters. The file stays in the report rather than being
excluded to inflate the total. No claim of 100% whole-project coverage is made.

## Commands and generated reports

```sh
npm test
# equivalent discoverable alias:
npm run test:coverage

npm run lint
```

`npm test` still runs `pretest`, migrates the test database and executes suites serially.
It now also collects coverage and fails if any global coverage metric falls below **95%**.
The alias invokes `npm test`, so it cannot accidentally skip migration or the gate.

Generated files include:

- `coverage/index.html`: browsable coverage report (`open coverage/index.html` on macOS).
- `coverage/lcov.info`: machine-readable report for future CI integrations.
- `coverage/coverage-summary.json`: totals per file.
- `coverage/coverage-final.json`: detailed counters and locations.

`coverage/` was already ignored by Git. ESLint now ignores that directory too because
HTML reports contain generated third-party JavaScript, not application source. Production
files remain included in lint and coverage. The reports are local artifacts, not committed
project documentation.

For a focused edit without the whole-project coverage gate:

```sh
npx jest --runInBand src/modules/loans/__tests__/applications.service.test.js
```

This does not migrate the database and is not a substitute for `npm test`. A targeted
integration suite still requires a running, migrated test database. Adding `--coverage`
to a focused run can correctly fail the global gate because the rest of the source was
not exercised. This behavior was verified deliberately: the two AppError tests passed,
but Jest exited 1 because whole-project coverage was below the configured threshold.
The full passing coverage report was regenerated afterward.

## Gaps addressed

| Area                    | Added checks / what a regression would break                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server entry point      | Starts on configured port, logs readiness, handles SIGINT/SIGTERM, waits for HTTP close and pool completion before exit. Mocks capture signals: tests do not signal the Jest process or open a real listening port. |
| Health database failure | Query rejection becomes generic HTTP 500 through the actual router/error handler; database hostname, password failure and SQL code do not leak.                                                                     |
| Registration failure    | Unexpected database errors and unrelated unique violations are rethrown, not mislabeled `EMAIL_TAKEN`. Password input is hashed before reaching the repository.                                                     |
| Missing destination row | Repository returns null when a lookup-to-lock race loses the destination; transfer refuses before balance, ledger or monitoring writes.                                                                             |
| Loan replay invariant   | A missing concurrent winner raises an error instead of inventing a successful replay.                                                                                                                               |
| Error defaults          | AppError defaults and client errors without explicit machine codes retain the intended JSON contract.                                                                                                               |
| Audit optional fields   | Missing connection/resource information becomes null and is recorded only after finish.                                                                                                                             |
| Environment selection   | Test uses `.env.test`, development/production use `.env`; dotenv is mocked so no real development secrets are read. Test logging is silent, other environments use info.                                            |
| Real operator CLI       | Missing email and unknown users exit nonzero; successful grants persist role and audit metadata; connection failure exits nonzero without claiming success or hanging.                                              |

The CLI smoke tests explicitly use a `_test` database. Parent test resets retain the
existing database-name guard. The connection-failure case targets a closed localhost
port and a fake `_test` database, not a real production service.

## Design decisions and limits

- **Global 95% gate, not a 100% promise.** It catches major coverage regressions while
  leaving room for bootstrap/CLI coverage limitations. It is not a per-file minimum;
  a small new untested function can still fit within the overall allowance.
- **Broad collection includes unimported source and operator files.** Otherwise unused
  files can disappear from the denominator and make coverage look better than it is.
  Test directories are excluded; runtime files such as `server.js` are not.
- **Coverage runs on every `npm test`.** Slight overhead buys a repeatable enforced check
  for local development and future CI. The normal full run remains around twelve seconds
  on this machine; timing is not a performance guarantee.
- **Mocks and real integrations are complementary.** Failure branches use controlled
  mocks; existing PostgreSQL suites still verify locks, constraints, ownership, balances
  and concurrent requests. CLI subprocesses verify actual entry-point behavior.
- **Execution coverage is not correctness proof.** It says which instrumented paths ran,
  not that all business requirements, values, errors or interleavings were considered.
  SQL migrations/constraints are tested behaviorally, not measured by JavaScript coverage.
  The shutdown test proves existing successful cleanup ordering, not real signal delivery,
  rejected cleanup handling, durable audit draining, or deployment behavior.

No production risks were silently fixed just to raise coverage. Existing limitations
remain: best-effort audit writes, token-role trust on the audit-list endpoint, no aggregate
loan exposure checks, and no deployment/CI verification yet. The make-admin role update
and audit write are still separate statements, not an atomic grant-and-log transaction.

## Files changed

- `jest.config.js`: collection scope, report formats and global coverage thresholds.
- `package.json`: enable coverage in `npm test`; add `test:coverage` alias.
- `eslint.config.js`: ignore generated coverage assets only.
- New tests under `src/__tests__/`, config, health, auth, accounts and shared utilities.
- Existing audit/error-handler/loan/transfer tests gain targeted failure-path assertions.
- `tests/integration/make-admin.cli.test.js`: actual operator subprocess smoke tests.

Day 19 requires no new migration and remains uncommitted until requested. Next: write the
OpenAPI/Swagger reference and README, then Docker/CI, deployment and final polish.
