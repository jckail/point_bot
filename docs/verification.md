# Overhaul verification

Verified on 2026-10-01. The overhaul remains active; these results cover the
implemented milestone and do not establish production deployment or all roadmap
requirements.

## Automated evidence

| Check | Result |
| --- | --- |
| Last combined workspace unit run | 303 passed: bot 20, extension 44, MCP 9, web 60, API client 20, core 150; this predates the current design/evaluation/remote-MCP/0009 changes |
| Dedicated PostgreSQL fixture | Latest expiry pass: 32 passed (24 agent + 8 baseline); actual migrations, repositories, concurrency and private-table RLS; see database-verification.md |
| Root ESLint | Passed with zero errors or warnings after cleanup |
| Workspace TypeScript | Passed for all seven workspaces |
| Production web build | Passed using Next.js 16.3.8, no network font dependency, placeholder publishable key and SKIP_ENV_VALIDATION |
| Extension, MCP, worker and bot bundles | Passed |
| MCP protocol | Prior compiled stdio discovery passed; current focused remote HTTP protocol suite passed with overlapping owner requests; aggregate recheck pending |
| Production dependency audit | Zero reported vulnerabilities after upgrades and compatible lockfile fixes |
| Full dependency audit | Six moderate development-tool advisories remain in Vitest/mocker and Drizzle Kit's legacy esbuild loader |

The latest focused assistant pass verified 12 SDK/usage tests, six HTTP route
tests, 24 extension background tests and four synthesized observability contract
tests. Web, extension and infrastructure TypeScript checks passed. This pass adds
cache/reasoning token details, correct completed-agent turn counts, correlation
for pre-run failures, and extension deadlines bounded below Chrome's worker fetch
limit. These results do not replace the pending aggregate run or live Chrome test.

The release review then added bounded owner/process admission control and HTTP
429 contracts. Seventeen admission/route tests, 21 focused core contract tests,
web TypeScript and lint of the affected files passed on exact mirror source.
The subsequent root ESLint pass and all seven workspace TypeScript checks passed;
the provider catalog's nine focused tests also passed after lint fixes.
Production deployment remains unverified. The isolated release worktree is
`/home/jkail/projects/point_bot-release`; the original checkout remains untouched
by release branch operations. Only semantic changes and new feature files are
copied there, excluding the pre-existing repository-wide line-ending churn.

The PostgreSQL tests are opt-in via `DATABASE_INTEGRATION_URL`. They skip when it
is absent and refuse a non-loopback or non-fixture database/user. The dedicated
fixture and temporary credential files were removed after verification.

## Verification environment

The active repository is now `/home/jkail/projects/point_bot`. Earlier
mounted-workspace commands encountered `process.cwd`/filesystem errors and slow
module resolution. Combined checks therefore ran in `/tmp/pointup-verification`
with Node 24.20.0 and a fresh dependency install. All edits remain in the actual
repository. A byte comparison confirmed every included source/config/manifest
matched the repository; generated build files, dependency folders, legacy archive
and environment files were excluded. The new PostgreSQL test and report were
copied into that mirror before their checks.

The updated root lockfile includes the production patches, including Next.js and
Nodemailer. The native checkout's copied dependency tree differs from that lockfile
and its esbuild binary returned EACCES before collecting tests. The verified mirror
already has the patched dependencies, so focused checks used it without reinstalling
or clearing caches. A future coordinated `npm ci` can align the native dependency
tree. CI builds the MCP bundle as well as the
existing application bundles. The separate CDK infrastructure passed four synthesized-template tests and typechecking in the prior pass. Its audit reports one high advisory in bundled brace-expansion. Current combined verification remains pending the shared resource gate.

## Unverified runtime gates

- No valid Clerk test credentials exist in this workspace. Placeholder build
  keys do not establish a functioning runtime. Attempts to render the production
  landing page could not pass Clerk initialization; no screenshot, responsive,
  authenticated HTTP or keyboard-flow result is claimed.
- Agent SDK tests use injected models and an in-process trace capture processor.
  Live model access, inference, usage billing, exporter delivery and operational
  dashboards have not been exercised.
- ChatGPT linking needs an approved registered client and deployment of the managed
  Drizzle migration. PostgreSQL fixture success does not establish a live OAuth round
  trip or independent ChatGPT sign-in. Clerk remains the session provider.
- The extension needs unpacked Chrome permission/capture/chat testing with a
  real PointUp session. Vendor partnerships and live balance APIs are not
  provisioned by this source update.
- Reviewed assistant actions, server-enforced account consent, scoped PATs and managed
  SIWC storage are implemented. Current normalization migration 0009 and atomic
  import/manual write work require database and aggregate verification.
- Remote private bearer MCP transport and the synthetic assistant evaluation harness
  have focused checks; live deployment, hosted OAuth and model quality review remain.

## Current resource gate

The portfolio PostgreSQL check used `agent-heavy-check` and exited 75 after the
shared 120-second lock wait. An unrelated job held the global resource gate. Its
log and dedicated fixture are preserved; root's aggregate unit attempt also exited 75 before any test execution. The unchanged command is not repeatedly
queued. Root is the broad verification owner and will run checks once the relevant
source settles and the gate is available. Broad Vitest defaults to two workers.
The resumed harness did not retain the prior Linux mirror, so it was recreated
with the checked-in lockfiles; no existing cache was cleared.

## Continuity

Agent Hub does not currently map the actual `point_bot` repository to a memory
scope. Its checkpoint command declined the write; these repository documents are
the local verified handoff. No remote memory was uploaded. The shared Graphify
query lacked PointUp source coverage. A shared refresh was requested and remains
queued/running behind the shared refresh lock; do not replace the corpus with a
PointUp-only graph or claim it has indexed this repository.
