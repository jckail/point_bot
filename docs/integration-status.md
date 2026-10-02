# Native overhaul integration into PR #14

## Preserved branches

Native work is preserved in [PR #15](https://github.com/jckail/point_bot/pull/15),
branch `codex/pointup-overhaul-20261001`, release worktree
`/home/jkail/projects/point_bot-release`. Runtime commit `4303c05` passed
[all four CI jobs](https://github.com/jckail/point_bot/actions/runs/36969293365):
371 unit tests, 47 PostgreSQL cases, eight infrastructure contracts, lint,
workspace types, application bundles and CDK synthesis. Later commits only
update verification/handoff docs. The original native checkout remains intact.

The integration branch is `codex/pointup-integrate-20261001` in
`/home/jkail/projects/point_bot-integration`, based on refreshed PR #14 head
`e04725fd01df49ce02ac3e0b14f4da96640ded41`. It preserves PR #14's outbox,
optimizer, transfer bonuses, catalog, retention, cache, stricter types,
OpenTelemetry, readiness and Docker/dev flows. This is a staged integration,
not the final combined release or production deployment.

## First integration stage

- Explicit Authorization never falls back to Clerk cookies or a seeded dev
  session. Clerk JWTs require independent verification and matching session
  identity; browser-only operations reject every Authorization header.
- Cookie mutations require an Origin matching validated canonical `APP_URL` or
  direct Host with the expected scheme. Forwarded hosts grant no trust. PAT and
  independently verified Clerk bearer clients retain their credential authority.
  Production HTTP Docker sets `APP_URL=http://localhost:<WEB_PORT>`; TLS proxies
  can configure their public HTTPS origin explicitly.
- Worker, bootstrap and CLI migrations share bounded advisory locking before
  Drizzle journal reads, dedicated two-connection pools, TLS tuning and cleanup.
  Known transaction-mode pooler URLs fail before connecting. Migration connections
  require direct PostgreSQL or a session pooler; application transaction pooling
  remains supported. The existing migration history is unchanged.
- OpenTelemetry spans, status messages and structured Error logs retain fixed
  diagnostic categories and validated public error codes, omitting upstream
  names, messages, stacks and payloads. The legacy assistant returns a generic
  unavailable response. SDK tracing privacy remains a separate port.
- Test workspace scripts bound Vitest to two workers. The migration CLI is included
  in core TypeScript checks. Compose configuration parsed successfully locally.

Runtime commit `74ad309c1184231187a85abbe4aa6f3b1c660b62` passed all six jobs in
[CI run 36971599307](https://github.com/jckail/point_bot/actions/runs/36971599307)
and [CodeQL](https://github.com/jckail/point_bot/actions/runs/36971599374).
The fresh lockfile installation, root lint, hygiene, all workspace TypeScript,
504 workspace tests including real PostgreSQL integration, production web and
worker/bot/MCP/extension bundles, plugin/spec checks, infrastructure synthesis,
nine HTTP MCP smoke tests, and Docker smoke in both direct and transaction-pooler
modes passed. The three isolated migration-lock PostgreSQL tests passed, covering
concurrent journal reads, bounded contention and rollback/lock release. This
fixture evidence does not establish the production database's schema state.

Earlier focused auth/policy checks passed 46 tests, migration helper checks 13,
and privacy/assistant checks 19 on exact source with existing mirror binaries.
Two strict privacy-test fixture errors found by CI were corrected before the
successful aggregate run. Local `npm ci` through `agent-heavy-check` exited 75
before installation because another project held the resource lock. Do not retry
unchanged or claim local worktree dependencies were installed. Root owns broad
verification; the passing aggregate evidence comes from this branch's fresh CI.

## Security dependency port

The PR #14 tree's report-only production audit found six advisories (one critical,
four high, one moderate). The integration now ports the already validated native
Next/ESLint 16.3.8 and Nodemailer 10.0.13 manifests and exact registry lock entries,
including patched sharp 0.35.5, PostCSS 8.5.23, nanoid 3.3.19 and browser mapping
2.11.27. PR #14 feature dependencies and tsx 4.23.15 remain preserved. Static
resolution checks covered 321 dependency-closure nodes and 77 manifest/lock
requirements; no installation or fresh audit is claimed by those checks.
Fresh CI then verified installation, full types and builds, and its application
production audit reported **zero vulnerabilities**. This result covers the
current lockfile and observed advisory database, not future advisories.
The infrastructure bundled brace-expansion advisory and separate development
advisories are not resolved by these application patches.

## Remaining integration and runtime gates

The second integration stage ports the TypeScript OpenAI Agents SDK into the
existing authenticated chat route, with read-only portfolio tools and immutable
manual-balance/trip-goal proposals for write-authorized principals. The web Agents
page reviews stored values; approval/rejection require a browser cookie session.
The extension sends bounded conversation history and opens one reused,
extension-owned review tab. Existing capture/writeback contracts remain intact.

SDK tracing defaults off, sanitizes cloned error spans, and uses independent
SDK IDs plus a server-generated run identifier. Application logs retain existing
OpenTelemetry IDs. Numeric usage is explicitly allowlisted; unknown usage remains
unknown. Process/owner admission, request/deadline bounds and synthetic evaluation
cases accompany the runtime. Live inference/export delivery remain unverified.

This stage appends **0016_assistant_actions** only. Migrations 0000–0015 remain
unchanged; the new snapshot links to 0015 and preserves its schema descriptors.
Actual installed Drizzle serialization and SQL generation in a scratch copy
confirmed zero pending migrations. An isolated, root-owned PostgreSQL 17 fixture
applied the complete managed history; six new proposal integration cases passed,
covering ownership, expiry/rejection, concurrent single execution, RLS/grants,
success-journal rollback and outbox failure/unknown recovery. Production composition
atomically commits the mutation, outbox and success journal after a durable claim.
These checks do not establish the production database's schema or live outbox delivery.

Exact local application `npm ci`, workspace types and production dependency audit
passed (zero production vulnerabilities). Full lint exposed minor assertion and
UI-handler issues, corrected by their owners. The infra install exited 75 before
execution because another project held the shared verification lock; use fresh CI
for its exact dependencies instead of retrying the unchanged install. The local full workspace suite then passed 645 tests, including all real
PostgreSQL cases; one paid live evaluation was intentionally skipped. Subsequent
client request-budget and observation-type refactors passed their focused checks.
Full aggregate CI/build evidence for this second stage is recorded after its source commit.

The later SIWC/goal milestone below adds 0017/0018 to this lineage. Versioned
observation token/consent/idempotency provenance is implemented in the later 0019
source/fixture checkpoint below, documented in
[observation-integration-plan.md](observation-integration-plan.md); staged numeric
constraints and remaining atomicity/RLS review also remain. Preserve historical
observations without inventing missing provenance, existing review IDs/outcomes,
`account_tag`, the `agent` balance source, outbox events and retention audit
semantics. Inspect actual deployment journals/tables and preserve a recoverable
backup before selecting/applying adoption migrations. Neither source branch proves
what schema reached staging or production.

Production deployment is authorized but currently lacks GitHub deployment secrets
and valid local AWS authentication. Live Clerk/OpenAI/Chrome testing, exporter
and dashboard delivery, approved ChatGPT client/session bridging, hosted OAuth MCP,
provider partnerships, dependency advisories and remaining data atomicity/RLS
work remain part of the original goal. iOS is deferred as requested.

Agent Hub does not map these worktrees to a configured memory scope, so curated
repository documents carry the handoff. Shared Graphify lacks PointUp coverage;
use targeted current source and refresh the shared corpus after source edits.
Reuse one browser tab per agent session. Do not replace the shared graph, run
parallel expensive checks, or disturb unrelated agents' processes/worktrees.

Detailed remaining release work is tracked in [release-backlog.md](release-backlog.md).

Second-stage source commit `6bc8dd5` passed CodeQL, plugin/spec validation and HTTP
MCP E2E, but aggregate CI found a type-import cycle, a locked-CDK driver type
mismatch, and the hardened client rejecting Docker's internal MCP HTTP target.
Follow-up source changes move shared SDK types into leaf modules, construct the
same concrete AwsLogDriver, and allow an explicitly pinned operator-configured
internal HTTP origin while retaining default HTTPS and redirect rejection.
Docker also exposed empty optional worker integration values; they now match the
web host's empty-string convention. Focused regressions, root lint and workspace
types pass. Fresh aggregate verification follows the fix commit.

## Verified combined assistant milestone

Runtime commit `3e21e4ea3dc75c67465f6461fa468ac4449995b6` passed all six jobs in
[CI 36975269376](https://github.com/jckail/point_bot/actions/runs/36975269376) and
[CodeQL 36975269389](https://github.com/jckail/point_bot/actions/runs/36975269389).
Fresh installation, root lint, import-cycle and duplication checks, all workspace
types, full managed migrations, **661 workspace tests** (one paid live evaluation
skipped), web/worker/bot/MCP/extension production bundles, 23-operation ChatGPT
spec validation, nine HTTP MCP smoke tests, default/MCP infrastructure synthesis,
six assistant template tests, existing TLS guard, and Docker smoke in direct and
transaction-pooler modes passed. The observed application production audit remains
zero vulnerabilities; development and bundled infrastructure advisories remain.

This verifies the combined source and isolated fixtures, not production deployment,
live Clerk/OpenAI behavior, Chrome browser execution, trace exporter delivery,
CloudWatch event arrival or production database adoption. The root-owned fixture
`pointup-sdk-pg-root-20261002` (loopback port 55443) is stopped, with its data retained.
No development server or browser tab was opened during this milestone. Root remains
the aggregate verification/release owner. Continue with the gates and priorities in
[release-backlog.md](release-backlog.md), preserving PR #14, #15 and #16 histories.


## SIWC linking and tenant-qualified goal milestone

The integration now includes ChatGPT identity **account linking** for an already
signed-in Clerk browser session. It preserves issuer/client/subject identity,
one-to-one owner mappings, hashed browser transaction keys, single-use expiry,
PKCE/state/nonce verification, safe callback diagnostics and private responses.
It does not create a Clerk session or provide independent ChatGPT sign-in. An
approved OpenAI OIDC client and a separately approved, independently verified
session bridge remain prerequisites for that broader capability. Live linking
and provider behavior have not been verified.

Additive migrations `0017_chatgpt_identity` and `0018_goal_ownership` are present
in the managed journal after proposal migration 0016. The SIWC adoption migration
preserves compatible existing links/transactions and refuses incompatible storage;
the goal migration preserves valid ordered membership and quarantines invalid
legacy associations before enforcing tenant-qualified ownership. Migrations
0000–0016 remain unchanged.

Root-owned focused real PostgreSQL checks now pass **23 cases**: ten
migration/adoption, six goal ownership and seven SIWC storage cases. The six goal
cases passed after the migration-lock correction, including an actual concurrent
membership-write blocking race. Migration 0018 locks the parent and membership
tables before archive/delete/backfill; its lock wait is bounded by a transaction-local
**30-second lock timeout**. A timeout requires diagnosis of the blocking workload
and a deliberate retry plan, not an unchanged automatic retry.

The managed migration command passed, earlier full root lint and all workspace
TypeScript checks passed, and installed Drizzle metadata validation reported
**zero schema drift**. The full workspace suite passed **708 tests**, with one
paid live evaluation skipped, **before the OAuth callback CSRF correction**.
The callback fix then passed 53 focused checks, including 11 through the real
shared HTTP/authentication boundary. Final full lint and all workspace types
passed. Final-source aggregate CI is recorded below. These are
fixture and source checks; they do not establish staging/production journals,
backup recoverability, hosted callback routing or live OIDC authorization.
The root-owned PostgreSQL fixture is stopped with data retained after final
checks; no unrelated processes, development servers or browser tabs were touched.

## Production verification gate and deployment state

Workflow commit `350ccc9` makes production verification reuse the complete
six-job CI gate, including its PostgreSQL fixture, Docker/direct/pooler smoke,
application bundles, plugin contracts and infrastructure checks. Both
[CI 36976573470](https://github.com/jckail/point_bot/actions/runs/36976573470) and
[Deploy verification-only 36976965575](https://github.com/jckail/point_bot/actions/runs/36976965575)
passed. The verification-only run deliberately skipped AWS deployment and
migration jobs. This closes the earlier missing-PostgreSQL deploy-verifier gap;
it is not evidence that AWS resources or a production database changed.

Real deployment remains blocked by expired local AWS authentication and absent
GitHub deployment role/Clerk secrets. Before activating schema-dependent hosts,
inspect the actual production journal/tables, establish and verify a recoverable
backup, choose the compatible adoption path, and apply managed migrations through
0019. The current deployment workflow still runs CDK deployment before its ECS
migration task; resolve migration-before-host-activation ordering rather than
letting new hosts serve against missing tables. Confirm the chosen hosting route,
public HTTPS canonical origin, Clerk session handling and SIWC callback/config
wiring before enabling linking. Observation migration 0019 is implemented and
applied only in isolated verification fixtures; production adoption is unverified. Original live SDK/exporter/Chrome/OAuth/provider and data-audit
work remains in [release-backlog.md](release-backlog.md).

## Verified identity and goal milestone

Runtime `7c7cd118f0cb4d15f4892ec21c68c6b99a05296d` passed all six jobs in
[CI 36979098872](https://github.com/jckail/point_bot/actions/runs/36979098872) and
[CodeQL 36979098961](https://github.com/jckail/point_bot/actions/runs/36979098961).
Fresh installs, lint, hygiene, workspace types, full managed migrations,
**721 workspace tests** (one paid live evaluation skipped), all five application
bundles, plugin/23-operation Action validation, HTTP MCP smoke, Docker direct
and transaction-pooler smoke, default/MCP CDK synthesis, TLS guard and
**13 infrastructure tests** passed. The application production audit reported
zero vulnerabilities; existing development/infra advisories remain separate.

This validates the callback correction and quarantine locking on the committed
combined source. It does not prove live approved-client authorization, standalone
ChatGPT sign-in, browser extension behavior or production database adoption.
A fresh deployment access check still found no GitHub repository secrets and
an expired local AWS session requiring `aws login`. No production deployment
or branch merge occurred. Root-owned PostgreSQL data is retained in the stopped
fixture. Shared Graphify refresh was requested for the whole corpus; PointUp
code coverage remains absent, so current source remains authoritative.

The subsequent observation source/fixture checkpoint below implements additive
migration 0019 and its authorization, replay and retention guarantees, documented in [observation-integration-plan.md](observation-integration-plan.md)
and [observation-client-plan.md](observation-client-plan.md). Also complete the
migration-before-host production rollout, numeric constraints, approved-client
sign-in policy and live verification gates in [release-backlog.md](release-backlog.md).


## Observation provenance and replay milestone (source/fixture checkpoint)

Additive managed migration `0019_observation_provenance_replay` and its backend,
HTTP, extension and MCP protocol are implemented in the integration source.
Protected atomic transactions serialize owner/capture keys, current PAT/grant
authorization and account/review writes. Authorization is rechecked after waits
and before commit; exact replay under rotated same-owner credentials preserves
the original receipt witnesses. Human resolution remains authoritative on replay.
Exact generated snapshot IDs support backdated captures; new known baselines use
snapshot identity, while historical version-0 SQL NULL witnesses retain the prior
points comparison. Existing review IDs/outcomes, `agent` balance source, activity,
outbox, consent and retention behavior remain intact.

The composite owned-account FK is **NOT VALID**: new references are enforced,
while retained legacy ownership/provider mismatches still require inspection and
separate validation. Missing historical provenance is not invented. Extension PAT
submissions freeze one request/key/time before sending, retain it through the
25-second timeout, and use bounded completion/discard tombstones; MCP forwards
caller keys without creating cross-user state or adding approval tools. Detailed
source anchors and limits are in [observation-integration-plan.md](observation-integration-plan.md)
and [observation-client-plan.md](observation-client-plan.md).

Root-owned actual PostgreSQL verification passed **44 cases**: 18 migration/adoption,
23 production-composed observation cases (including five additional authorization/
review races) and three retained integration cases. Managed migration through 0019
passed. Nine sync/host checks passed: three new shared-boundary regressions, four
existing sync cases and two exact-host policy cases. Full root lint and all workspace
TypeScript checks passed on the current source.

The first gated workspace run found one documentation-contract failure: the
replay-conflict 409 row was missing from `docs/api.md`. Root corrected the row,
seven focused error-code checks passed, and the subsequent gated full workspace
run passed **834 tests**, with one paid live evaluation skipped. Exact runtime `d9ffc381169c4287458d402fdf43c576e4956617` now passes all six jobs in
[CI 36983533954](https://github.com/jckail/point_bot/actions/runs/36983533954) and
[CodeQL 36983533965](https://github.com/jckail/point_bot/actions/runs/36983533965). The earlier verified identity/goal milestone
above remains valid for its own committed source. The whole shared Graphify corpus
refresh completed (164,478 nodes); PointUp coverage remains absent, so live source
remains authoritative. The root-owned PostgreSQL fixture is stopped with data
retained after final checks. No production migration, host activation, live Chrome/provider
capture, approved OIDC client or exporter delivery is established here.
Migration-before-host rollout and the broader original scope remain release gates.

Observation source0819571 passed CodeQL and five CI jobs in
[CI36983027317](https://github.com/jckail/point_bot/actions/runs/36983027317):
infra, plugin/spec, HTTP MCP, Docker direct/pooler and report-only audit. The
application job stopped at hygiene because extension capture-state and messages
formed a type import cycle. Shared RecordResult now lives in a leaf module,
preserving existing re-exports without disabling the hygiene rule. Eighteen
focused capture tests, extension types and changed-file lint pass; fresh
aggregate CI follows the fix commit.

## Next bounded work, underway

Numeric domain/adapters and additive 0020 adoption, backfill metadata preservation,
and the travel frontend port are assigned to five agents with exclusive file ownership.
Root retains aggregate verification, PostgreSQL and release operations. Plans:
[numeric integrity](numeric-integrity-plan.md), [frontend integration](frontend-integration-plan.md),
[production rollout](production-rollout-plan.md). These plans are not completed runtime claims.
Migration-first deployment, real standalone ChatGPT sign-in, live assistant/exporter and
extension checks, remaining arithmetic limits and access-screen visual integration remain open.
