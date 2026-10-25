# Day 15: loan quotes

## Starting state and roadmap

The supplied report describes completion through Day 14, including audit logs and admin
access. However, both this checkout and GitHub HEAD were `e50c2f9` (Day 13) when this work
started. Audit/admin files and their migration are absent. Do not claim 613 passing tests
or audit logging for this checkout; recover and verify Day 14 separately.

Update: Day 14 was subsequently implemented and committed as `e29b070` (append-only
audit log, admin-only audit endpoint and make-admin command). The loan route is mounted
alongside the new audit route. The original starting-state note above is historical.

Using the project's accelerated numbering, Day 15 starts the roadmap's Days 17–18 loan
module. This increment implements **quotes only**: EMI, indicative eligibility and an
amortization schedule. It does not create applications, approve loans, disburse money,
collect repayments or persist income. No migration or repository is needed yet.

Next: implement the application lifecycle for the next loan increment;
then monitoring/alerts, coverage, OpenAPI/README, Docker/CI, deployment and polish.

## API

`POST /api/v1/loans/quote`, with a Bearer token and JSON body:

```json
{
  "principal": 10000000,
  "tenureMonths": 12,
  "monthlyIncome": 5000000,
  "existingMonthlyEmi": 0
}
```

All amounts are **integer paise**. The example borrows Rs 1 lakh and returns an EMI of
888488 paise (Rs 8,884.88). Existing EMI defaults to zero. Unknown fields are dropped;
the caller cannot choose the interest rate or eligibility result.

Response: `200 { "quote": { principal, tenureMonths, annualRateBps, currency, emi,
totalInterest, totalRepayment, schedule, eligibility } }`. Each schedule row contains
`month`, `payment`, `principal`, `interest`, `balance`. These are relative month numbers,
not due dates. An ineligible quote still returns 200; invalid input returns 400 and absent
or invalid credentials return 401. No idempotency key is required because nothing is written.

## Explicit demo policy (not specified by the original handoff)

- Principal: Rs 1,000–10 lakh; tenure: 6–360 months.
- Fixed annual nominal interest: 12% (1200 basis points), monthly reducing balance.
- Minimum declared monthly income: Rs 15,000.
- Existing monthly EMI plus the largest proposed installment must be at most 40% of
  declared monthly income. The paise allowance is rounded down; equality passes.
- Input income and existing EMI are capped at Rs 10 lakh per month.
- This is an educational estimate, **not approval or verified credit underwriting**.
  There are no credit checks, fees, taxes, insurance, penalties or prepayments.

## Files and trade-offs

| File in `src/modules/loans/` | Responsibility / what breaks if wrong                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `loans.schema.js`            | Bounds and JSON types; missing bounds permit costly calculations or invalid money.        |
| `loans.calculator.js`        | Exact rational EMI and integer-paise schedule; rounding errors break reconciliation.      |
| `loans.service.js`           | Server-owned rate and eligibility policy; wrong thresholds misclassify affordability.     |
| `loans.controller.js`        | HTTP response only.                                                                       |
| `loans.routes.js`            | Auth before validation; missing guard exposes the endpoint anonymously.                   |
| `__tests__/`                 | Known EMI, boundary validation, eligibility, schedule invariants and real-app HTTP tests. |

`src/modules/index.js` mounts the router. No existing banking rules are changed.

The annuity formula uses BigInt powers and rational division instead of floating-point
money. EMI and each month's interest round half-up to the nearest paise. The final
installment pays the remaining principal and interest, absorbing accumulated rounding;
it may differ from the EMI. Affordability therefore checks the largest installment.
Zero interest is supported by the calculator for testing/future policy, not selectable
through the API. BigInts stay internal; bounded outputs are safe JSON numbers.

Quotes do not consult the database, so they rely on existing JWT authentication and
self-declared income/debt. As elsewhere, a valid token is not a fresh user/role lookup.
The existing whole-API limiter applies; there is no additional quote-specific limiter.

## Verification

Verified: all 65 new tests passed (4 suites), and the full PostgreSQL-backed regression
suite passed **678 tests across 41 suites** after Day 14 was committed and Docker became
available. ESLint and formatting also passed.

Run the new tests without PostgreSQL:

```sh
npx jest --runInBand src/modules/loans/__tests__
npm run lint
```

The HTTP tests exercise the real Express app and JWT middleware but mock database access
to fail if a quote queries SQL. They are not PostgreSQL integration tests.

For the complete regression suite, start Docker Desktop first, then:

```sh
docker compose up -d
npm test
```

The initial baseline attempt was blocked by the unavailable Docker daemon; this was
resolved before the successful full regression run above.
