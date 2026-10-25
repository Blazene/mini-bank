# Day 22: GitHub Actions CI

Day 21 was committed and pushed as `0770b6f`. Day 22 adds CI configuration and its
regression checks; there are no new banking rules, dependencies or database migrations.

## Workflow

`.github/workflows/ci.yml` is named **CI** and runs on:

- Pushes to `main`.
- Pull requests (not the privileged `pull_request_target` event).
- Manual `workflow_dispatch` runs from the Actions tab.

No source-path filter can silently skip test runs for a change. A concurrency group per
workflow/ref cancels superseded runs. Test and Docker jobs have 15/20-minute timeouts.

### Tests, lint and coverage

The `test` job uses Ubuntu 24.04 and Node 22, with a PostgreSQL 16 service on localhost 5432. Its user/password/database match the existing migration command and `.env.test`.
PostgreSQL initializes **minibank_test** before the health check succeeds, so the workflow
does not depend on a developer's pre-existing database. All credentials are disposable
test values, not production secrets.

Steps:

1. Check out source without persisting the checkout token.
2. Set up Node 22 and npm download caching keyed by `package-lock.json`.
3. `npm ci` — fresh locked dependency installation, not cached platform-specific node_modules.
4. `npm run lint`.
5. `npm test` — includes pretest migrations and the four-metric 95% global coverage gate.
6. `npm audit --audit-level=high` — fails on high/critical advisories or registry errors.
7. Upload `coverage/` as `coverage-node22` for seven days, even after a non-cancelled
   failure. If installation/lint failed before reports were produced, absence warns rather
   than obscuring the original failure. Hidden files and the rest of the workspace are not uploaded.

There is no `continue-on-error` bypass. Audit and artifact behavior do not turn a failed
test into success. The audit threshold does not suppress lower-severity output; it only
sets the exit-code threshold. Dependency auditing still cannot prove absence of unknown issues.

### Docker stack verification

The `docker` job starts only after the test job passes, on its own Ubuntu 24.04 runner.
It checks Docker Engine/Compose availability and runs `npm run test:docker`. This is not
just an image build: Day 21's checker verifies fresh migrations, health, non-root/read-only
runtime, auth/money/loan/alert flows, credential redaction, container recreation and data
persistence. It creates/removes only its random project/image/volume. There is no database
service shared across jobs or connection to a development/deployed database.

Images are not published, and this workflow does not deploy the application. Docker
build-cache plumbing is intentionally omitted for now; the first Linux build may be slower.
Hard cancellation may interrupt the script's cleanup, but GitHub-hosted runner resources
are ephemeral and do not hold a developer's database.

## Security and maintenance choices

- Top-level permission is only `contents: read`. No job escalates it; no repository
  secrets, deployment keys or registry publishing credentials are required.
- Untrusted PR code runs on the normal PR event with read-only access, not a privileged
  target-branch context. This does not make dependencies or arbitrary PR code trustworthy.
- Official actions are pinned to full commit SHAs verified against their release tags:

| Action                    | Release | Commit                                     |
| ------------------------- | ------- | ------------------------------------------ |
| `actions/checkout`        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node`      | v7.1.0  | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2  | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

- `.github/dependabot.yml` requests weekly npm, GitHub Actions and Docker version updates,
  with up to five open PRs per ecosystem. It does not enable auto-merge. Pinning reduces
  mutable-tag risk but requires reviewing future pin/security updates.
- The README badge links to this workflow's actual hosted status. It is not a hardcoded
  success badge and may be unknown until the first run.
- Branch protection/rulesets and Actions repository policies are administrator settings,
  not silently changed by this work. After the first successful run, consider requiring
  **Tests, lint and coverage** and **Docker stack verification** before merging.

## Local verification and limits

Verified locally after a clean `npm ci`:

- **64 suites, 918 tests passed** (9 new CI configuration tests since Day 21), with
  the CI test environment values and existing four-metric coverage gate enabled.
- ESLint, `git diff --check` and `npm audit --audit-level=high` passed; the audit
  reported zero known vulnerabilities.
- The full isolated Docker build/API/persistence/redaction verification passed.
- actionlint syntax/expression validation passed. The action release SHAs were checked
  against their official Git tags before pinning them.
- No hosted GitHub Actions run has been performed for these uncommitted files.

`npm ci` emitted an upstream `glob@10.5.0` deprecation warning; it was not suppressed.
The install and audit still succeeded. Dependency deprecations and advisories should
continue to be reviewed rather than treating a green audit as permanent assurance.

`tests/unit/ci.config.test.js` checks the triggers, permissions, pin format/allowed actions,
Node/cache setup, test-database consistency, mandatory gate commands, report upload scope,
timeouts, job dependencies and weekly update configuration. It parses YAML with the existing
explicit dev dependency; no new tooling dependency was added.

The workflow was also checked with **actionlint 1.7.12** for syntax and expressions. Its
official Darwin/ARM64 archive SHA-256 was verified before execution; no global installation
or disabled TLS verification was used. Optional ShellCheck/Pyflakes integration was disabled
for this local actionlint invocation. The workflow's shell commands are static npm/Docker calls.

Local reproduction uses:

```sh
npm ci
npm run lint
npm test
npm audit --audit-level=high
npm run test:docker
```

PostgreSQL and Docker must be running locally as described in the README. Local macOS
success and workflow linting are **not a hosted Ubuntu/GitHub Actions run**. Actual runner
image compatibility, npm cache/artifact actions and repository policy need confirmation
after Day 22 is committed and pushed. The Day 21 push did not contain this new workflow,
so it cannot have executed these jobs yet.

To confirm hosted CI afterward, open GitHub -> Actions -> CI, check both jobs, and download
the coverage artifact if needed. First-time fork PRs can require repository-owner approval.
Do not claim a green hosted run merely because local tests passed.

Next: confirm hosted CI, then deploy a disposable educational demo with private secrets,
HTTPS, correct proxy/CORS configuration and live smoke checks. Changes remain uncommitted
until requested.
