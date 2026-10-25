# Day 24: backend review and portfolio polish

## Outcome and scope

The backend has a documented demo, accurate architecture overview, point-in-time security
review, repeatable safe HTTP checker and frontend handoff. No frontend code, new paid
resource, database migration, dependency upgrade, cloud admin grant or PR merge is included.
Published as **`1302383`** after authorization. [Both hosted CI jobs passed](https://github.com/Blazene/mini-bank/actions/runs/40195821465),
and Render successfully auto-deployed the hardened bootstrap. Subsequent frontend work
is a separate change, not part of that Day 24 run.

## Deliverables

1. [Demo walkthrough](demo.md): a five-minute Swagger presentation, exact fake-paise
   balances/EMI/replay results, and an optional local-only operator/admin/monitoring story.
2. [Architecture](architecture.md): Render/Neon trust boundaries, module/request diagram,
   all six business tables (including audit, loans and monitoring), and transaction sequence.
   Distinguishes a transaction history ledger from full double-entry accounting, and local
   Compose hardening from controls actually known on Render.
3. [Security review](security-review.md): controls/evidence, retained risks, two local fixes
   and individual Dependabot PR decisions. No claim of a security audit or production bank.
4. `scripts/verify-demo.js`, exposed as `npm run verify:demo`: defaults to GET-only checks.
   An explicit writable run creates random disposable data; remote writes require a second
   acknowledgement. It follows no redirects, bounds requests, prints no response bodies/
   tokens/passwords, uses no dotenv/DB/operator access and performs no resets/deletes.
5. Unit/real-PostgreSQL integration tests for checker safety and full demo outcomes, startup
   validation regressions, and `.gitignore`/npm-hook regressions. Existing Docker verification
   also runs the read-only checker against its production container.
6. [Frontend handoff](frontend-handoff.md): public API base, CORS planning, in-memory auth,
   stable idempotency keys, integer paise, cursors/errors and initial screen scope. Planning
   only: no frontend implementation, hosting or origin allowlist changes yet.
7. README portfolio links and accurate current-versus-local deployment status.

## Configuration fixes

- Reject query `host=` overrides instead of checking a host that pg might not use.
- Require exactly one Neon `sslmode=verify-full` (the URL API and pg select duplicate
  parameters differently), normalize/decode hostnames for pooler checks, and reject global
  TLS-certificate bypass for Neon. Validation fails before migrations/API with safe errors.
- Ignore `.env.*` variants, keeping only explicit nonsecret example/test files versionable.
  This prepares for future frontend `.env.local` files without adding any frontend code.

These are guardrail fixes for private configuration/accidental secret commits, not evidence
that an unauthenticated HTTP caller could edit Render environment settings.

## Verification

Verified on Node.js **22.23.3**, with the existing lockfile and unchanged coverage gates:

| Check                                            | Result                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL/Jest regression                       | **72 suites, 1012 tests passed** (41 added since Day 23)                                                                                   |
| Global statements / branches / functions / lines | **98.34% / 98.05% / 97.89% / 98.30%**; each exceeds 95%                                                                                    |
| ESLint                                           | Passed                                                                                                                                     |
| Dependency audit                                 | **Zero known vulnerabilities**, high/critical gate passed                                                                                  |
| Full isolated Docker check                       | Passed, including hardened Render startup/restart/shutdown, read-only demo checker, admin/monitoring, log redaction and volume persistence |
| Existing public API read-only checks             | Passed; no writable hosted demo run in Day 24                                                                                              |
| Git ignore behavior                              | Private local/production/nested environment variants ignored; example/test exceptions preserved                                            |
| Documentation local links / whitespace           | Passed                                                                                                                                     |

The test database and isolated Docker database are separate from the hosted demo; no cloud
reset is involved. Shell/child-process execution is not included in Jest's JavaScript
coverage accounting; full runtime coverage must not be inferred from the percentages.

```sh
npm test
npm run lint
npm audit --audit-level=high
npm run test:docker
npm run verify:demo -- --base-url https://mini-bank-api-2bxt.onrender.com
git diff --check
```

The writable checker is tested against the guarded local `_test` database: two users,
two accounts, three transactions, one pending application, balances **65000/25000 paise**,
quote EMI **888488**, replay/refusal/ownership/role assertions, no admin user. Its read-only
mode is separately checked to leave those business tables empty. Unit tests cover unsafe
origins, CLI flags, remote-write acknowledgement, public response/network failures and
error-output privacy. HTTP requests can still produce ordinary audit/access logs.

The hosted read-only run passed against the existing service without creating users,
accounts, money or loan applications. Authenticated Render settings were reviewed without
revealing private values: Free/Singapore, CI-gated auto-deploy, expected Docker bootstrap/
health path and previews off. Publication follow-up: `1302383` passed
[both hosted CI jobs](https://github.com/Blazene/mini-bank/actions/runs/40195821465),
Render auto-deployed it, and public read-only verification passed again. That result does
not claim a hosted run for the subsequent, initially unpushed frontend implementation.

## Dependency decisions

- Node 26 PR **#1**: hold. Confirmed failure is the explicit Node 22 Docker config test;
  Docker verification is skipped, so Node 26 runtime compatibility is not established.
- dotenv patch **#2** and ESLint patch **#3**: reviewed diffs are limited to manifest/lock
  updates. Older hosted checks pass but use pre-deployment baseline `47949cc`; refresh/retest
  against current main before a separately authorized merge.
- No PR was changed, approved or merged, and no proposed update was installed here.
  Full findings and run/head links are in the security review.

## Remaining limits and next step

Free-tier cold starts/quotas, shared limiter storage, independent-client proxy verification,
cloud admin workflows, measured load, backup restoration, durable audits and real banking
requirements remain out of scope. They are documented limitations, not silently passed tests.

Day 24 implementation and verification are complete and published. Future publishing still
requires explicit authorization, green CI for the selected commit, a successful deployment,
and a public read-only check. No paid resource or role-grant workaround is needed.

Next: agree on frontend technology/layout and implement the client against the existing
contract. Do not weaken API authorization, TLS, CORS or retry semantics to make UI work.
