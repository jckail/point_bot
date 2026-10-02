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

## Numeric and travel-interface candidate (local verified checkpoint)

Implemented additive numeric migration0020, safe domain/adapter boundaries,
normalized valuation/watch rates, exact point totals/transfer intermediates and
bounded optimizer arithmetic. Backfill/manual/agent/sync readings preserve newer
expiry metadata and use a fresh monotonic mutation timestamp while retaining
original capture provenance. Seven staged NOT VALID constraints preserve historical
rows; production inspection/repair/validation is still required.

The light travel landing, consistent brand/auth assets, responsive portfolio
sections/search/type/tag/reset, pending form controls and access/settings hierarchy
are integrated. All nine catalog kinds, the PR14 optimizer and existing auth,
review, consent and identity semantics are retained. Detailed implemented scope
and browser limits are in numeric-integrity-plan.md and frontend-integration-plan.md.

Root verification:108 focused numeric/backfill/optimizer cases,16 actual PostgreSQL
adoption/production metadata cases, managed migration20, full lint, all workspace
types and hygiene pass (no cycles,0.17% duplication). The final local aggregate
workspace command did NOT start: shared agent-heavy-check queue returned75 after
its bounded wait; log /tmp/pointup-numeric-travel-full-test.log preserved, no bypass
or unchanged retry. Fresh committed-head CI is required for aggregate/build evidence.
One owned browser tab/server checked 390px/1440px layouts, filtering/reset, named
goal progress, working skip focus and assistant Escape/focus return; both stopped.

Production deployment remains blocked by unavailable AWS/GitHub deployment access
and the migration-before-host/TLS rollout work, not by overall source progress.
Continue production-rollout-plan.md implementation, approved-client standalone
ChatGPT sign-in, live assistant/exporter/provider/extension checks, remaining cash/
deal/rate integrity, public OAuth MCP/plugin onboarding and provider partnerships.
iOS remains deferred. Original active overhaul goal and other preserved branches
remain; this candidate is not a completed goal or production deployment.

## Verified numeric/frontend release checkpoint6b424f6

Exact runtime6b424f64a94d89d6355dd851af7e1e74c59517b0 passes all six
[CI36986531693](https://github.com/jckail/point_bot/actions/runs/36986531693)
jobs and [CodeQL36986531747](https://github.com/jckail/point_bot/actions/runs/36986531747).
CI confirms943 workspace tests (one paid live evaluation skipped), managed migration20,
lint/types/hygiene, all five bundles, infrastructure checks, plugin/Action contracts,
HTTP MCP and Docker direct/PgBouncer smoke. Application production audit reports
zero vulnerabilities; infrastructure/development advisories remain tracked separately.
The local aggregate exit75 is retained as an accurate resource result; fresh CI
provides authoritative aggregate evidence for this committed source.

Root-owned PostgreSQL fixture pointup-sdk-pg-root-20261002 is stopped with data
retained. Shared whole-corpus Graphify refresh completed164478nodes; PointUp code
coverage remains absent. Agent Hub checkpoint was refused because the worktree
has no configured memory scope; curated repository docs carry continuity. A fresh
AWS identity check still requires aws login; GitHub deployment secret list is empty.
No production deployment, legacy repair/constraint validation, branch merge or
approved-client/live provider/model/exporter verification occurred.

Next active ownership: SDK agent owns deploy workflow and candidate migration
helper/offline tests; migration agent owns CDK inactive bootstrap/TLS/DB-only migration
task configuration; assistant agent owns baked migration manifest/journal attestation;
release-review agent independently audits rollout. Root owns pinned cdk-assets
dependency/lock, aggregate checks, actualPG/AWS/release and integration. Source plans
are production-rollout-plan.md; preserve constructidentities and enforce migration
BEFORE host/schedule activation. These next changes are not included in6b424f6 evidence.
Standalone ChatGPT sign-in, live extension/assistant/tracing, remaining rate/deal/cash
integrity and provider/developer onboarding remain open in the original active goal.

## Migration-first deployment candidate

The team implemented the candidate release helper, protected inactive bootstrap,
mandatory TLS/canonical origin, exact-production OIDC trust and bounded purpose-
tagged migration permissions. Every ECS candidate image and its actual published
CloudFormation template asset are pinned; the original file publisher role is
preserved. An existing-stack resource/protected-property guard runs before updates.
Existing databases require a completed available encrypted exact-DB snapshot no
older than24h. First creation uses a verified CREATE-only stub and remains inactive;
later activation requires an explicit protected manual readiness attestation.

Worker candidate mode checks baked manifest and historical journal prefix before
pending SQL, refuses unjournaled PointUp tables, verifies the complete journal and
bounded physical readiness, then flushes schemaVerified attestation while locked.
Physical readiness checks required columns/named CHECKs, selected owned FKs,
enabled ownership trigger and RLS for all19 managed tables. NOT VALID is accepted;
this does not certify historical data, equivalent types/definitions/indexes or a
restore rehearsal. Safe release receipts retain task/log references and failures.

Root evidence so far:29 helper cases, earlier25 infrastructure cases, final2 IAM
cases and infrastructure types, workspace lint/types,14 actual PostgreSQL cases.
Final RLS case and committed-head CI remain pending. Final local infrastructure
aggregate/synth did NOT start (shared queue75); /tmp/pointup-rollout-infra-final.log
is preserved. The separate local workspace aggregate also did not start75; do not
reuse old runtime CI as evidence for this new source or bypass the shared lock.

Fresh AWS identity is expired (aws login needed) and deployment secrets are empty;
no AWS deployment occurred. Plans/review and remaining work are preserved in
production-rollout-plan.md, production-rollout-review.md and release-backlog.md.
Original overhaul goal remains active. Standalone ChatGPT sign-in, live assistant/
exporter/Chrome/provider smoke, remaining numeric cash/deal/rate boundaries,
public OAuth MCP onboarding and partnerships remain next; iOS is deferred.

## Verified rollout release a754875

Exact rollout a754875c562fcd578d9cf8131102e47ea455af56 passes all six
[CI36991025330](https://github.com/jckail/point_bot/actions/runs/36991025330)
jobs and [CodeQL36991025255](https://github.com/jckail/point_bot/actions/runs/36991025255).
CI verifies985 workspace cases (one paid live evaluation skipped),29 offline rollout
cases,25 infrastructure cases, actual PostgreSQL15 migration/schema attestation
cases including RLS drift, managed migration20, full lint/types/hygiene, all bundles,
contracts/HTTP MCP and Docker direct/PgBouncer smoke. Application production audit
is zero vulnerabilities; the infrastructure high advisory remains separate.
The final local RLS-specific command did not start75; fresh CI supplies its proof.
The local database container is stopped with data retained. No production deploy.

Independent follow-up audits reproduced deal numeric-token truncation and stale
extension discard selecting a newer unseen capture, plus a shared review-tab race.
SDK agent now owns bounded deal parsing/tests; extension agent owns captureId-bound
discard, shared tab serialization and popup recovery feedback. Root retains checks/
release. These follow-up edits are not covered by a754875 CI and require fresh proof.
Remaining FX/cash limits, reopened in-flight extension chat, approved standalone
ChatGPT sign-in and live provider/model/exporter/deployment gates remain preserved.

## Numeric and extension follow-up candidate

Implemented complete bounded deal token parsing, exact signed FX conversion with
explicit unavailable overflow, captureId-bound extension discard, shared serialized
review tab and restored popup receipt/error feedback. Root composed79 focused cases,
full workspace types and lint pass. Earlier rollout CI does not cover these edits;
fresh committed-head CI is next. Details are in numeric-integrity-plan.md and
extension.md. Live deployment still awaits renewed AWS login and configured role/
TLS/Clerk/backup ownership; no secret is requested in chat. Remaining in-flight chat
persistence and API support references, broader rates/currency inference, approved
standalone ChatGPT sign-in and provider/exporter/Chrome live proof remain open.

## Verified follow-up runtime3e7ba69

Exact runtime3e7ba69e3ea95853f4c7f428a27358ba4509f3d5 passes all six
[CI36992427488](https://github.com/jckail/point_bot/actions/runs/36992427488)
jobs and [CodeQL36992427509](https://github.com/jckail/point_bot/actions/runs/36992427509).
CI confirms1023 workspace tests (one paid live evaluation skipped),29 rollout cases,
25 infrastructure cases, managed migration20, all15 real PostgreSQL attestation
cases, full lint/types/hygiene, all five bundles, contracts/HTTP MCP and Docker
API/PAT/consented-capture smoke through direct PostgreSQL and PgBouncer.
Root's composed79 focused cases also pass. These source fixes are now verified;
prior pending wording above is historical checkpoint state.

Shared whole-corpus Graphify refresh completed164478nodes after the settled source;
PointUp coverage is still absent. Agent Hub has no configured memory scope, so
these curated docs carry continuity. No new browser tabs/windows or development
server were opened; owned PostgreSQL remains stopped/data retained. AWS identity
still reports expired login after the asynchronous renewal request; repo deployment
secrets remain absent. No production deploy/merge/legacy-data repair is claimed.

Next: real AWS/stack/TLS/Clerk/snapshot/restore configuration and read-only staging
smoke, approved-client standalone ChatGPT authentication/account policy, live SDK/
exporter/provider/Chrome lifecycle proof, in-flight extension chat recovery and
capture request references, broader source-currency/rate/cash boundaries, public
OAuth MCP/plugin onboarding and provider partnerships. Keep the original goal
active and preserve the stacked PR14/PR15/PR16 branches; iOS remains deferred.

## Extension recovery and currency candidate

The next candidate persists scoped pending assistant questions before network
submission, recovers reopened popup status and retains an uncertain outcome after
worker restart without automatic replay. Diagnostic UUIDs reach the API as
x-request-id; they do not authorize or deduplicate writes. Capture errors now
show fixed public guidance with validated request references and distinguish
personal-token scope from legacy browser-session authentication.

Deal ingestion rejects explicitly foreign or mixed currency lines and non-US
alphabetic dollar prefixes instead of publishing their cash as USD. A foreign
page currency declaration requires an explicit USD token. Ordinary bare dollar
compatibility remains; this is a bounded vocabulary, not universal currency
detection. FX adapters reject a
supplied non-USD base, and aggregator balances reject unsafe rounded integers.
Root verified77 extension plus103 focused core cases, full workspace lint/types
and whitespace checks. Fresh candidate CI is required after commit; previous
docs-only8a06591 passes CI36992988875 and CodeQL36992988783.

[Standalone design](chatgpt-standalone-plan.md) separates approved website/Clerk
session issuance from open-source ChatGPT plan usage. Dynamic registration does
not establish hosted-app eligibility or a safe browser credential flow. Remaining
work: real OAuth provider/session compatibility, public MCP OAuth onboarding,
live model/exporter/provider/Chrome checks, remaining numeric boundaries and AWS
rollout prerequisites. Agent Hub still lacks project memory routing; retain this
curated checkpoint. The original goal remains active.

## Verified recovery/currency runtime5e72a0f

Exact source5e72a0fa815bdbffcf231200a01127704b7de7e4 passes all six
[CI36994857164](https://github.com/jckail/point_bot/actions/runs/36994857164)
jobs and [CodeQL36994857140](https://github.com/jckail/point_bot/actions/runs/36994857140).
CI confirms1106 workspace tests and one skipped paid live evaluation, all bundles,
managed migration20, PostgreSQL attestation, rollout/infrastructure checks,
contracts/HTTP MCP and Docker direct/PgBouncer smoke. Root180 focused tests and
full workspace lint/types also pass. Logs: /tmp/pointup-recovery-ci.log,
/tmp/pointup-recovery-final-tests.log and /tmp/pointup-recovery-typecheck.log.

The shared Graphify refresh after the final reviewed source completed164478nodes
successfully. PointUp graph coverage remains absent; live source supplied context.
Agent Hub checkpoint creation explicitly refused this unconfigured memory scope;
no hosted memory upload occurred. Fresh AWS STS still reports expired login.
No new browser tab, development server, production deploy or merge occurred.

## MCP/privacy and web uncertainty candidate

Implemented MCP safe-integer validation from shared contracts and fixed public
tool/resource/prompt errors with validated support references. HTTP validates its
upstream before listening, handles malformed targets without crashing, bounds
method/path telemetry and requires canonical HTTPS discovery for public production
hosts; CDK injects MCP_PUBLIC_URL. Startup failures omit private configuration.
The web assistant retains request correlation and gives explicit proposal review/
refresh guidance because a proposal can persist after the response deadline.

The disabled, unwired JWT-only OAuth read-principal adapter is implemented with
actual Clerk signature/header verification and mandatory explicit issuer, audience,
client, owner, time and read-scope checks. It rejects opaque tokens and grants no
write/session/PAT authority.46 tests include real signed-token default-SDK calls
without network. Provider resource issuance and live revocation remain unverified;
this does not enable public OAuth or standalone ChatGPT sign-in.

Root57 MCP plus59 web focused cases and workspace lint/types pass. Two actual
source CLI startup checks reject malformed/private upstreams with exit1 and fixed
public output. Local CDK synth did not acquire the shared verification queue
(exit75); its preserved log is /tmp/pointup-mcp-tls-synth.log. Fresh committed-head
CI must cover the new template check. Previous docs1522aac passes all6 CI36995394518
and CodeQL36995394448. AWS login remains expired; no production mutation occurred.
Continue provider/account compatibility, live inference/exporter/Chrome, numeric/
legacy-data and deployment work from the existing backlog. Original goal active.

## Verified MCP runtime and provider safety continuation

Runtime05a0eed0f73fc0d1712b000a073de3e4453940ae passes all six
[CI36997108617](https://github.com/jckail/point_bot/actions/runs/36997108617) jobs
and [CodeQL36997108649](https://github.com/jckail/point_bot/actions/runs/36997108649):
1192 workspace tests plus one paid live skip, all bundles, managed migration20,
PostgreSQL attestation, contracts/HTTP MCP and Docker direct/PgBouncer smoke.
The preceding E2E fixture incorrectly fabricated an authentication code; it now
uses the actual UNAUTHENTICATED contract and asserts private error text is absent.

The next candidate disables implicit simulated balances for real-user sync.
Simulation requires explicit dev authentication or factory opt-in; unsupported
sync preserves existing balances and metadata. Dashboard cards and account pages
show available API, demo or manual/capture paths. API configuration does not prove
provider access. Aggregator transport rejects unsafe URLs, prohibits credential
redirects, bounds responses and emits fixed private-safe failures. Deployment
configuration enforces matching URL restrictions. Worker terminal, scheduler,
delivery, purge and outbox logs omit raw exceptions and identities; diagnostic
sink failures cannot change delivery, retries or exit status.

Root focused verification:48 core provider/transport/sync,10 web capability/UI,
17 worker privacy/purge and30 rollout helper cases. Fresh committed-head CI must
verify this candidate; the runtime05 evidence does not cover these new changes.
AWS login renewal remains pending; no production mutation, browser tab or server
was created. Agent Hub still refuses the unconfigured project memory scope;
these curated repository documents preserve continuity. Original goal active.
