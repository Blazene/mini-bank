# Demo walkthrough

## Open the project

- [Live Swagger UI](https://mini-bank-api-2bxt.onrender.com/api/v1/docs/)
- [Health](https://mini-bank-api-2bxt.onrender.com/api/v1/health)
- [OpenAPI JSON](https://mini-bank-api-2bxt.onrender.com/api/v1/openapi.json)
- [Source and CI](https://github.com/Blazene/mini-bank)

This is currently an API, not a customer-facing website. Free hosting can take roughly
a minute to wake. **Use only disposable fake data.** Swagger's Try it out changes actual
demo rows. Public visitors are customers, not administrators.

## Repeatable automated walkthrough

Node.js 22 is required. The checker needs only Node built-ins; it does not load `.env`,
connect directly to PostgreSQL, grant an admin, reset a database or delete existing rows.

Read-only checks against the live demo (GETs only):

```sh
npm run verify:demo -- --base-url https://mini-bank-api-2bxt.onrender.com
```

This checks DB-backed health, security headers, unlisted-origin CORS denial, OpenAPI,
Swagger HTML, missing-token denial and invalid-token denial. The server can still record
normal request/audit logs. It does not prove browser rendering, proxy-IP isolation, load
capacity, backup recoverability or every security property.

For a full **local** walkthrough, start the API as in the README, then:

```sh
npm run verify:demo -- --base-url http://localhost:3000 --write
```

To deliberately create demo data on the **hosted** API, acknowledge both flags:

```sh
npm run verify:demo -- --base-url https://mini-bank-api-2bxt.onrender.com --write --allow-remote-writes
```

Each writable run creates exactly two random fake users, two accounts, three money
movements and one pending loan application. Retries/denied operations must not add more
business rows. Balances end at **65000** and **25000 paise**. The quote EMI is **888488**.
The script prints only named checks, not passwords, JWTs or response bodies; generated
credentials stay in memory. It follows no redirects and bounds each HTTP request at 120 s.

Rows are deliberately **left in place**, including on a partial failure; there is no public
cleanup endpoint and audit logs are append-only. Repeated runs consume free quotas and the
10-registrations/hour/IP allowance (two registrations per writable run). A failing run exits
nonzero. Fix the cause before rerunning, rather than flooding a free service. Do not use
this tool against real customers or a service you are not authorized to test.

## Five-minute manual story in Swagger

### 1. Show a healthy, protected API

Expand `GET /health` → Try it out → Execute. Expect 200 and database `up`.
Try `GET /accounts` without authorization: expect **401**. Explain that documentation is
public but balances and money operations require a signed access token.

### 2. Register Alice and Bob

Use `POST /auth/register` twice, with distinct fake emails you have not used before:

```json
{
  "email": "alice-demo-UNIQUE@example.com",
  "fullName": "Alice Demo",
  "password": "Demo-only-24pass!"
}
```

Use a different email/fullName for Bob. Login with `POST /auth/login`. Keep both tokens
private. In Swagger's **Authorize** box paste just the current user's token (Swagger
adds `Bearer`). Tokens are not persisted across a page reload.

### 3. Make accounts, move fake paise, prove retry safety

Authorize as Alice and `POST /accounts` with `{"type":"savings"}`. Save its account **id**.
As Bob create `{"type":"current"}` and save its **accountNumber** and id.

Back as Alice:

1. Deposit using `POST /transactions/deposit`, a fresh key such as `demo24-deposit-UNIQUE`,
   and `{"accountId":"ALICE_ID","amount":100000}`. That's Rs 1,000, not Rs 100,000.
2. Execute the exact request again with the same key. Expect **201**,
   `Idempotent-Replayed: true`, and still only **100000 paise** credited.
3. Change the amount to `100001` without changing the key. Expect **422**, not another credit.
4. Transfer `25000` using a **new** key and
   `{"fromAccountId":"ALICE_ID","toAccountNumber":"BOB_NUMBER","amount":25000}`.
   Replaying the identical transfer/key must not pay Bob twice.
5. Withdraw `10000` with another new key and `{"accountId":"ALICE_ID","amount":10000}`.

Alice ends with **65000 paise** (Rs 650), Bob with **25000** (Rs 250), with three Alice
history rows. An account id identifies a protected resource; an account number identifies
a transfer recipient. Bob must receive **404** when reading Alice's account id.

Explain: balance changes, the ledger row and monitoring alerts share one DB transaction.
Fixed-order row locks and the retry key handle concurrency/retries; the UI must not try
to enforce correctness itself. The money is simulated, not connected to payment rails.

### 4. Quote and submit a loan

As Alice, quote with:

```json
{ "principal": 10000000, "tenureMonths": 12, "monthlyIncome": 5000000 }
```

Expect EMI **888488 paise** (Rs 8,884.88), at the demo's fixed 12% nominal annual rate.
Quoting is read-only. Submit the same terms to `POST /loans/applications` with a fresh
idempotency key; expect **pending**. Replay it and show the same application id, not a
second application. Bob's GET of Alice's application returns **404**.

A customer's `GET /admin/alerts` returns **403**. Approval is an admin decision only;
it never disburses money. Income/debt are declared, not independently verified.

### 5. Close with engineering trade-offs

Show [architecture](architecture.md), [security review](security-review.md) and the CI
badge. Explain integer paise, atomic writes, replay semantics, cursor privacy, immutable
saved loan terms and the difference between transactional monitoring and best-effort audits.
Coverage and a green CI run are evidence, not proof of banking compliance/security.

## Optional admin/monitoring demo — local operator only

For a trusted local setup, make the already registered **Bob** an admin, not Alice:

```sh
# Node-host workflow, using the existing local development environment:
npm run make-admin -- bob-demo-UNIQUE@example.com

# Or, for the local full Docker stack:
docker compose exec -T api npm run make-admin -- bob-demo-UNIQUE@example.com
```

Use the actual fake email you chose. Bob must login again to get an admin token. Review
Alice's application as approved with a customer-visible reason of at least 10 characters,
e.g. `Disposable demo review only`. Repeating that exact reviewer/decision/reason is a
replay; a conflicting decision returns 409. Self-review is forbidden.

To demonstrate monitoring, use extra fake funding of **10000000 paise** and five outgoing
small transfers within five minutes, each with a new key. Bob can then inspect the
`LARGE_TRANSACTION` and `RAPID_TRANSFERS` alerts and selected audit entries. Do not claim
these heuristics prove fraud or constitute a regulatory AML system.

`npm run test:docker` already automates the local admin/alert/persistence scenario in an
isolated project. **Do not grant cloud admins, share an admin token, expose a setup endpoint,
or point local reset/test tools at Neon just to present the public demo.**
