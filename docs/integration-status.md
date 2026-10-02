# PointUp integration status

The full overhaul goal remains active: preserve PR #14's capabilities while
integrating the native overhaul, strengthening frontend/backend/data behavior,
completing assistant and identity integrations, and delivering a verified
production release. Source integration and fixture verification have progressed;
production activation, live integrations and the remaining data audit are open.
iOS remains deferred at the user's request. Concrete next actions are in
[release-backlog.md](release-backlog.md).

## Current evidence and release state

Pending expiry/rejection now returns safe conditional-transition receipts. The
service audits only those receipts in list/approve/reject, including claim expiry
after its row lock. Repeated/concurrent losers add no receipt event; audit sink
failures preserve outcomes. DTOs, schema, private account witnesses and mutation
behavior are unchanged. This remains best-effort telemetry, not crash-durable
audit delivery; merged-source verification follows below.

The latest merged proposal-transition release is [PR #37](https://github.com/jckail/point_bot/pull/37)
at master `26643eccf2087f19df36e3299ed577627387263b` (source
`b65afd58c8f8862198e4fd57e9c96e8c7683c097`, tree
`bb774ef7501810d354feca0c733d8a32f427d44f`). All six candidate verification jobs
in [CI 37042066067](https://github.com/jckail/point_bot/actions/runs/37042066067),
[CodeQL 37042066082](https://github.com/jckail/point_bot/actions/runs/37042066082)
and Bugbot passed. All six merged-master verification jobs in
[Deploy 37042811100](https://github.com/jckail/point_bot/actions/runs/37042811100)
and [CodeQL 37042810552](https://github.com/jckail/point_bot/actions/runs/37042810552)
passed with 1,739 workspace tests and one paid live skip, including 17 actual
PostgreSQL assistant-action cases. The local PostgreSQL check did not execute:
the shared heavy-check gate returned exit 75. Database evidence comes from CI.
AWS deployment remained skipped for missing deployment-role configuration.

The preceding observability release is [PR #36](https://github.com/jckail/point_bot/pull/36)
at `dd6a9701b55df0ddcdfe3ab5bf6857c360153cf9` (source
`b97413645630a6205d05781c2cf28e71137d2486`). All six merged-source verification
jobs in [Deploy 37038650269](https://github.com/jckail/point_bot/actions/runs/37038650269)
and [CodeQL 37038649758](https://github.com/jckail/point_bot/actions/runs/37038649758)
passed with 1,722 workspace tests and one paid live skip. Failed terminal assistant
runs now contribute bounded latency metrics. AWS deployment remained skipped for
missing deployment-role configuration.

[PR #35](https://github.com/jckail/point_bot/pull/35) aligned exact HTTP loopback
permissions and recorded native popup evidence. Its merged commit
`95b610e21851bf2356c30277d521fd95f314db1e` passed six
[release jobs](https://github.com/jckail/point_bot/actions/runs/37037630570) and
[CodeQL](https://github.com/jckail/point_bot/actions/runs/37037630107), with 1,714
workspace tests and one paid live skip. An isolated native permission probe also
verified real local fetches through localhost, IPv4 and IPv6; its scope and remaining
application acceptance gates are in [Chrome evidence](chrome-extension-acceptance.md).

CSV portability and cancellation fixes are merged at
`7e4a5b23cdb7d1cc6bb91c17f267f2b70fff136a` through
[PR #34](https://github.com/jckail/point_bot/pull/34). All six merged-source jobs
in [Deploy 37033664518](https://github.com/jckail/point_bot/actions/runs/37033664518)
and [CodeQL 37033664139](https://github.com/jckail/point_bot/actions/runs/37033664139)
passed with 1,707 workspace tests and one paid live skip. AWS deployment remained
skipped for missing deployment-role configuration.

The recovery polish is merged at
`d65b0f1dd585c1ef9a5f54dcbe4cefb5a41ae271` through
[PR #33](https://github.com/jckail/point_bot/pull/33). All six merged-source jobs
in [Deploy 37030692963](https://github.com/jckail/point_bot/actions/runs/37030692963)
and [CodeQL 37030692749](https://github.com/jckail/point_bot/actions/runs/37030692749)
passed: 1,694 workspace tests plus one paid live skip. AWS remained explicitly
skipped for missing deployment-role configuration.

Shared Chrome extension tools are available after the coordinated restart. The
prior native build attempt hit the shared queue limit (exit 75). After contention
cleared, the wrapped build and actual Chrome action-popup acceptance passed for
synthetic offline recovery, reopen, in-flight controls, Clear and review-tab reuse.
Two explicit intercepted chat attempts occurred, with none from reopening/review.
Own test storage, popup/review pages and extension were cleaned up; the existing
tab was preserved. This does not establish provider/API/model or worker-termination
acceptance. See [exact evidence and limits](chrome-extension-acceptance.md).

The claim/identity/goal fixes below are merged at
`e3e33b5d6a98ffe416af180c98b0b3aca909ff29` through
[PR #32](https://github.com/jckail/point_bot/pull/32). All six merged-source
verification jobs in [Deploy 37029520512](https://github.com/jckail/point_bot/actions/runs/37029520512)
and [CodeQL 37029519862](https://github.com/jckail/point_bot/actions/runs/37029519862)
passed, including 1,687 workspace tests plus one paid live skip. AWS deployment
was explicitly skipped for missing deployment-role configuration.

The current follow-up fences outbox completion/retry/dead-letter updates to the
exact claimed attempt and lease deadline, guards reviewed manual balances against
changed account membership, locks goal reference mutations and deduplicates goal
progress. Root verified 14 actual PostgreSQL outbox cases and nine PostgreSQL
goal/assistant identity cases against the migrated isolated fixture, without
resetting existing rows. Those focused checks are supplemented by the exact
merged-source aggregate evidence above; production adoption remains unverified.

The manual-entry form accepts a real UTC calendar date. Blank means the current
time; a past day uses noon UTC, while today's reading is capped at the current
time so entry before noon cannot create a future observation. Malformed and
future days are rejected. Actual server-action/use-case regressions cover these
boundaries.

The recovery successor adds a Chrome proposal-review button available even
after a first uncertain request, preserving its support reference during
navigation. Stalled assistant executions now emit bounded audit/metric metadata
only for rows actually recovered to `unknown`. Root passed 17 popup, 31 assistant
unit and four actual PostgreSQL cases, including repeated/concurrent recovery
and telemetry failure isolation. Its merged-source gate is recorded above;
recovery telemetry remains best effort rather than a durable audit journal.

| Source | Verified evidence | Limits |
| --- | --- | --- |
| `977a4d586c269e1a3f34b82a8c5a2fdae9355f45` | All six jobs in [CI 36999223376](https://github.com/jckail/point_bot/actions/runs/36999223376) and [CodeQL 36999223346](https://github.com/jckail/point_bot/actions/runs/36999223346) passed. CI covered 1,243 workspace tests, one skipped paid live evaluation, 30 rollout helper and 26 infrastructure cases, all application bundles, managed migration 0020, PostgreSQL attestation, contracts/HTTP MCP and Docker direct/PgBouncer smoke. | Source/isolated-fixture evidence; no production deployment or live provider/model/exporter proof. |
| `370130945ff34fa1ac7775984068d837d9e7d4bc` (verified upstream/capture milestone) | All six jobs in [CI 37000134163](https://github.com/jckail/point_bot/actions/runs/37000134163) and [CodeQL 37000134144](https://github.com/jckail/point_bot/actions/runs/37000134144) passed. CI covered 1,302 workspace tests, one skipped paid live evaluation, 30 rollout and 28 infrastructure cases, managed migration 0020/PostgreSQL attestation, all bundles/contracts/HTTP MCP and Docker direct/PgBouncer smoke. Root also passed 130 focused core, 50 extension and 11 actual migrated PostgreSQL outbox cases, workspace lint/types, infrastructure types and whitespace checks. | Source and fixture gate complete; production, historical-data repair and live integrations remain open. |
| `12e5de23442f2c76b5ea0bdb841d640cba0fd097` (card-aware account/capture milestone) | All six [CI 37007102694](https://github.com/jckail/point_bot/actions/runs/37007102694) jobs and [CodeQL 37007102367](https://github.com/jckail/point_bot/actions/runs/37007102367) passed: 1,401 workspace tests plus one paid live skip, 30 rollout/28 infrastructure cases, all bundles, managed migration 0021/PostgreSQL attestation, plugin/contracts/HTTP MCP and Docker direct/PgBouncer smoke. Root also passed 18 actual PostgreSQL card/capture/race cases and workspace checks. | Exact-source fixture evidence; subsequent targeted assistant/dependency changes require fresh committed-source gates. |

The assistant/dependency successor `d4b9ada6af859732caecd215190582d69918dca4`
passed all six [CI 37010044921](https://github.com/jckail/point_bot/actions/runs/37010044921)
jobs and [CodeQL 37010044928](https://github.com/jckail/point_bot/actions/runs/37010044928).
It covers 1,414 workspace tests plus one paid live skip, 30 rollout/28 infrastructure
cases, clean installs, actual tooling compatibility, all bundles, managed 0021/
PostgreSQL attestation, plugin/contracts/HTTP MCP and Docker direct/PgBouncer smoke.
The application audit includes development dependencies and reports zero findings;
the separate CDK bundled advisory remains open. Root's local clean install hit the
shared queue limit (exit 75); CI establishes its own successful clean-install evidence.

The last verified application production dependency audit reported zero
vulnerabilities. Separate infrastructure/development advisories remain tracked;
that result does not certify future advisories. Prior local heavy-check queue
failures (exit 75) remain accurate resource outcomes; later successful CI supplies
committed-source aggregate evidence, not a retroactive local pass.

Local AWS STS responded on October 2, superseding the earlier expired-session
result. Read-only us-east-1 inspection found a legacy PointUp Elastic Beanstalk
environment; it does not establish managed ECS or database lineage. Fresh GitHub
inspection still found no deployment secrets or production environments. No production
migration, host activation, DNS change or production deployment is
claimed. The combined source was merged through PR #16 at
`cab150cc2eabcf9765350a1a4d39d5bb944ee95b`. All six merged-source verification
jobs passed in [Deploy 37019388599](https://github.com/jckail/point_bot/actions/runs/37019388599),
with [CodeQL 37019387403](https://github.com/jckail/point_bot/actions/runs/37019387403)
also passing. The AWS job was skipped for missing `AWS_DEPLOY_ROLE_ARN`.
Root owns release operations; the exact verified source is ready for the remaining
external and production gates.

## Preserved source and capabilities

The preserved combined branch is `codex/pointup-integrate-20261001`, worktree
`/home/jkail/projects/point_bot-integration`. [PR #16](https://github.com/jckail/point_bot/pull/16)
merged into `master` and includes [PR #14](https://github.com/jckail/point_bot/pull/14), refreshed from
`e04725fd01df49ce02ac3e0b14f4da96640ded41`. [PR #15](https://github.com/jckail/point_bot/pull/15)
preserves the native overhaul in `/home/jkail/projects/point_bot-release`;
the original checkout remains intact. Preserve those histories and avoid publishing
whitespace-only churn from the native checkout.

The integration retains the optimizer, transfer bonuses, all nine catalog kinds,
outbox, retention, cache, strict types, OpenTelemetry, readiness, scoped PAT APIs,
ChatGPT Action tools and Docker/dev flows. The travel interface includes responsive
portfolio sections, search/type/tag/reset controls, branded auth assets and accessible
assistant/review flows. Source tests and earlier bounded layout checks do not replace
live authenticated Chrome and extension acceptance. See
[frontend integration](frontend-integration-plan.md).

Authentication rejects invalid explicit bearer credentials without cookie/dev
fallback. Browser-only mutations reject Authorization headers. Cookie mutations
require the configured canonical origin or direct Host with its expected scheme;
forwarded hosts are not trusted. Configured development/Docker origins remain
supported. OAuth callbacks retain their separately verified transaction protections.

The Agents SDK runtime has read-only portfolio tools and immutable balance/goal
proposals for write-authorized principals. Browser review requires a cookie session;
approval/rejection are excluded from the generated Action spec. Admission, body,
UTF-8 history and deadline bounds apply. Tracing defaults off, honors its kill switch,
sanitizes SDK spans and uses generated correlation identifiers; unknown usage stays
unknown. Live model quality, export delivery and dashboard arrival remain open.
See [assistant agent](assistant-agent.md).

The verified assistant candidate adds exact-route transfer estimates using the owned account's
saved card and dated rules, independent of ranked advice truncation. Application
development dependency remediation moves tests to Vitest 4.1.11 with explicit
discovery and caller-scoped compatibility checks; its settled lock audit is clean.
The infrastructure CDK bundled advisory and production/live gates remain open.

The watch/extension/observability predecessor
`ba19fd8d0e5009a635edba0d00f2303af6b8060a` passed all six
[CI 37014262812](https://github.com/jckail/point_bot/actions/runs/37014262812)
jobs and [CodeQL 37014263548](https://github.com/jckail/point_bot/actions/runs/37014263548):
1,507 workspace tests plus one paid live skip, 30 rollout/28 infrastructure cases,
all bundles, managed 0021/PostgreSQL attestation, contracts/HTTP MCP and Docker
direct/PgBouncer smoke. Root also passed four actual PostgreSQL watch lock barriers.

## Current recovery and expiry follow-up

Calendar-month projections clamp to the last valid day of the destination month
while preserving UTC time. United MileagePlus no longer receives the catalog's
obsolete 18-month inactivity deadline, consistent with
[United's primary announcement](https://united.mediaroom.com/2025-05-29-JetBlue-and-United-Announce-Blue-Sky-Unique-Consumer-Collaboration-That-Links-Loyalty-Programs).
There is no bulk rewrite of saved dates; reads and historical captures retain
existing values. Forward activity retains the existing recalculation behavior,
which now yields no United inactivity deadline. Other catalog durations are not
newly verified by this correction.

The extension preserves acknowledged capture receipts when a later display refresh
or badge update fails. A failed refresh disables stale capture controls and directs
the user to reopen the view. Actual storage/HTTP failures retain uncertain outcomes.
Assistant diagnostics also retain valid server references containing punctuation,
using the same bounded reference format as the web client.

The web assistant now has bounded, owner-scoped tab recovery. Pending questions
and support references survive navigation as uncertain outcomes without automatic
replay; aborted late responses cannot be confirmed. Root verified actual
React/Next development UI behavior in one isolated Chrome tab using controlled
synthetic requests: draft reload, Stop/late success, pending navigation and return
with zero automatic chat attempts, and Clear/reload. The owned tab and temporary
server were closed; other agent tabs were untouched. This establishes that bounded
development UI behavior, not live Clerk owner rotation, paid inference or extension
provider acceptance. See [assistant-agent.md](assistant-agent.md).

The backend follow-up validates public-share expiry consistently across dashboard,
HTTP and core callers, rechecks current share authorization after loading a public
snapshot, and distinguishes elapsed account deadlines from rounded future days.
Root's settled successor workspace suite passed 1,568 tests plus one paid live
skip against retained managed-0021 PostgreSQL, with workspace lint/types and
whitespace checks. Focused and fresh committed-source CI evidence is recorded on
PR #16; earlier commit-specific evidence above remains scoped to those commits.

The redemption follow-up performs optional award search before reading current
portfolio/card context and owner-visible bonuses, then evaluates at a fresh clock.
It removes expired-window funding and includes bonuses that started during search.
The active-bonus read filters again after its repository wait. Focused gated tests
and fresh committed-source CI evidence are recorded on PR #16; these source changes
do not establish current provider award availability.

## Data integrity and migration lineage

Managed migrations 0000–0015 are preserved. Additive migrations are 0016 assistant
proposals, 0017 ChatGPT identity, 0018 goal ownership, 0019 observation provenance/
replay, 0020 numeric integrity and 0021 explicit nullable card selection.
Fixture journals and metadata do not prove which
lineage reached staging or production.

Proposal execution commits the balance/goal mutation, outbox and success journal
atomically under production composition. Goal adoption preserves compatible ordered
membership and quarantines invalid legacy associations. Migration 0018 locks parent
and membership tables before archival/backfill and has a transaction-local 30-second
lock timeout; diagnose contention before a deliberate retry.

Observation submission/review locks current credentials, consent and account/review
state, rechecks authorization after waits and before commit, and serializes owner/
capture replay. Same-owner credential rotation revalidates current authority while
retaining the original receipt witnesses. Human resolution remains authoritative on
replay. Exact generated snapshot IDs protect known baselines and backdated captures;
legacy version-0 SQL NULL witnesses retain points-based review fallback. Existing
review IDs/outcomes, auto-link scopes, `agent` balance source, tags, activity and
outbox remain preserved. See [observation backend](observation-integration-plan.md)
and [client recovery](observation-client-plan.md).

Numeric boundaries validate safe integers, normalize supported milli-unit values,
use exact checked point/transfer/FX arithmetic and bound optimizer intermediates.
Historical manual/agent/sync captures preserve newer explicit/null expiry metadata
and use fresh monotonic mutation timestamps while retaining capture provenance.
Staged NOT VALID numeric/owned-account constraints enforce new writes but leave
legacy rows for inspection, repair and separate validation; missing historical
provenance is not fabricated. See [numeric integrity](numeric-integrity-plan.md).

Previously verified source milestones remain available without repeating every
intermediate checkpoint: identity/goal `7c7cd118f0cb4d15f4892ec21c68c6b99a05296d`
passed [CI 36979098872](https://github.com/jckail/point_bot/actions/runs/36979098872)
and [CodeQL 36979098961](https://github.com/jckail/point_bot/actions/runs/36979098961);
observation `d9ffc381169c4287458d402fdf43c576e4956617` passed
[CI 36983533954](https://github.com/jckail/point_bot/actions/runs/36983533954)
and [CodeQL 36983533965](https://github.com/jckail/point_bot/actions/runs/36983533965).
Those results cover their own source and fixtures.

## Provider, capture and private failure boundaries

Real-user sync no longer implicitly simulates balances. Simulation requires
explicit dev authentication or factory opt-in; unsupported sync preserves current
balances/metadata. UI capabilities distinguish configured API, demo and manual/
capture paths. Catalog/playbook presence or an API configuration is not proof of
provider access. Historical simulated snapshots used `sync`, also used by genuine
adapters; the source value alone cannot classify or justify deleting historical data.

Extension requests freeze capture key/time/payload, preserve uncertain submissions
through their 25-second timeout, and use bounded completion/discard tombstones.
Discard binds the displayed capture ID; shared review-tab creation is serialized.
Scoped pending questions and support references survive popup reopening. Conservative
numeric/context extraction and explicit foreign-currency rejection avoid silently
inventing a reading. The new bank candidate adds four program-specific readers
with exact hosts, correct units and US Amex region evidence. Live Chrome/provider
coverage remains open; Capital One rewards-host compatibility is unverified.

Updated worker/MCP and upstream failure boundaries omit raw exceptions, identities and payloads.
Aggregator/upstream transports validate targets, bound responses and reject unsafe
credential redirects. Candidate 3701309 adds shared private-safe scraper/award/legacy
LLM transport, fixed IngestDealPage failures, redirect-safe webhooks and generated-
reference-only new outbox retry/dead-letter diagnostics. Actual PostgreSQL cases cover
private notifier failures through persistence. Historical outbox error scrubbing,
finite dead-letter/replay retention and backup-retention policy are still unimplemented.

The current `/dashboard/agents` follow-up keys both management and proposal-review
panels by the authoritative signed-in owner. An owner change remounts both panels;
same-owner refresh preserves their local state. Independent source review and
focused lint/type checks passed. The controlled native fixture did not execute:
the shared verification queue returned exit 75. No tab or fixture server opened,
and the attempt was not retried unchanged. Native lifecycle and live Clerk
owner-switching acceptance remain open.

## Deployment and identity boundaries

The reusable production verifier includes the complete six-job gate; verification-
only dispatch deliberately skips AWS writes. Migration-first rollout source pins all
candidate images and the actual template asset, guards existing resource identities,
requires an approved recent encrypted exact-DB snapshot, verifies the candidate
manifest/journal prefix before SQL and checks bounded physical schema readiness under
lock. First creation uses a verified CREATE-only inactive bootstrap and stays inactive;
later activation requires protected manual readiness attestation. Required TLS,
canonical origin and DB-only migration secrets are in source. Actual IAM, TLS/DNS,
production journal, backup restoration and AWS task/activation remain unverified.
Named readiness checks do not prove equivalent physical types/definitions/indexes
or valid historical rows. See [rollout plan](production-rollout-plan.md) and
[independent review](production-rollout-review.md).

Current ChatGPT identity functionality links an already signed-in Clerk owner; it
does not create an independent Clerk session. Standalone sign-in remains a separate
unimplemented provider/reconciliation/MFA design. Website client approval and
subject-only Clerk compatibility must be established without email auto-linking or
backend ticket bypasses. Open-source plan usage has a distinct dynamic registration
path without a partner API key; PointUp licensing/eligibility and safe web/extension
runtime support are not established. Protected token storage outside browser storage,
a genuine loopback callback/runtime and a compatible inference adapter are required.
See [standalone and plan-usage design](chatgpt-standalone-plan.md).

Public MCP OAuth is not enabled. A disabled, unwired JWT-only read-principal adapter
uses actual Clerk cryptographic/header verification plus explicit issuer, audience,
client, subject, time and scope checks; 46 offline tests include locally signed tokens.
Opaque-token resource binding, live revocation, provider issuance/client compatibility
and backend integration remain gates. It grants no session/PAT/write authority.
See [public MCP auth plan](public-mcp-auth-plan.md).

## Continuity and verification ownership

Root owns broad verification, PostgreSQL fixtures and release operations. Expensive
checks use the shared heavy-check gate, two workers and one verification owner;
contention is not permission to bypass the lock. Root-owned database fixtures are
stopped with data retained; synthetic redirect servers are closed. Preserve unrelated
worktrees/processes and reuse one browser tab per agent session when authorized.

The final whole-corpus Graphify refresh completed 164,478 nodes with exit 0
(log `/tmp/pointup-upstream-final-graph.log`), but
PointUp coverage remains absent: query first, then inspect current source. Agent Hub
refuses this worktree's unconfigured memory scope; curated repository documents carry
continuity without uploading private investigation material.

## Bank capture continuation

The new candidate adds synthetic Chase Ultimate Rewards, US Amex Membership
Rewards, Capital One Miles and Bilt extraction coverage and matching exact bank
content-script hosts. It preserves seven airline/hotel rules and current replay/
review behavior. Product/unit/region guards reject cash, status, offers, malformed
or conflicting readings, including the separately reproduced Bilt Cash case.
All captures now mirror backend HTTPS/no-userinfo/standard-port admission. The
popup supplies program coverage and consent/sign-in/review steps.

Root84 composed extraction/record/state/popup cases, workspace lint/types and
whitespace checks pass; fresh committed-head CI is required. Official
navigation/API research is recorded in [integrations.md](integrations.md). It
establishes partnership leads, not API access or logged-in extraction proof.
The existing Capital One rewards seed remains unverified; its current public
login link is insufficient evidence to broaden capture authorization.

Docs-only83d59b1 passes all six CI37000871611 jobs and CodeQL37000871596.
AWS renewal remains pending; no live account, provider credentials, Chrome tab,
production mutation or merge occurred. Full original goal remains active.

Bank runtime7aa47f3637f5e2433b493451c97d120b62843c51 passes all six
[CI37002246223](https://github.com/jckail/point_bot/actions/runs/37002246223) jobs
and [CodeQL37002246352](https://github.com/jckail/point_bot/actions/runs/37002246352):
1328workspace tests plus one paid live skip, all bundles/migrations/attestation
and Docker direct/PgBouncer smoke. Its final shared Graphify refresh completed
164478nodes, exit0. A new follow-up fixes canonical Southwest capture IDs and
adds all-reader catalog/host invariants;88 composed extension cases and workspace
lint/types pass. Corrected Amex transfer effective-date notes need no numeric
change. Fresh committed-head CI is required for this follow-up.

The source audit also established a release-blocking Chase→Hyatt card-eligibility
calculation gap. [Card-aware design](transfer-eligibility-plan.md) records the
required persisted selection, effective resolver, inverse coverage/advice/hint
consistency, user-facing flow and migration proof. The following source milestone implements this fix; passing bank CI alone did not close the incorrect fundability behavior.

## Card-aware transfer source milestone

Explicit nullable card selection now crosses domain, repository, contracts,
HTTP/client, CSV, web linking/editing and assistant tools. Rankings, funding,
inverse coverage and hints use the same dated rule resolver; raw conditional
edges cannot bypass it. Verified Preferred/Ink/Corporate products use 4:3 from
October 1, 2026; Reserve, unknown and unverified historical rules are excluded
with visible warnings. Direct Hyatt and unrelated transfers remain usable.

Migration 0021 adds the nullable compatible-provider selection without inferred
backfill. Eleven actual PostgreSQL card cases, 58 focused account/physical
attestation cases, 79 settled domain/application cases, eight web action/account
cases and seven bot command cases pass locally. Workspace types and lint pass;
final bot fixture lint is rechecked after the warning addition. The broad local
workspace run was blocked by shared-lock contention (exit 75), with no unchanged
retry or bypass. Fresh committed-head CI must establish the aggregate candidate
gate and application bundles before readiness is claimed.
Peer review caught explicit-null import conflict and warning navigation issues;
both are fixed. The graph query has no PointUp source coverage, so source was
inspected directly. Agent Hub refuses this unconfigured worktree scope; curated
repository docs preserve the verified handoff without hosted transcript uploads.

At this earlier checkpoint, AWS STS reported an expired session; the October 2
read-only check above supersedes that result. No deployment, merge, live provider
account or new Chrome tab/window was used. Production adoption, standalone
ChatGPT identity/inference eligibility, public MCP OAuth, live observability
acceptance, historical data/retention and the full original overhaul remain open.

### Transaction and receipt verification follow-up

Account edit, unlink and restore now lock/recheck the current owned row inside
the same atomic unit of work, preventing stale edits from resurrecting unlinked
accounts or overwriting omitted metadata. CSV imports acquire provider/row locks
in a stable order, validate every explicit card/tombstone before writes and join
all balance/link effects to one transaction. Production imports fail closed when
transaction/locking wiring is absent; composition supplies both.

Five actual PostgreSQL lock-barrier cases pass: edit behind unlink is denied
without an update event, delayed patches keep current metadata, unlink preserves
a prior edit, competing restores emit once, and conflicting import writes no
other program. Two additional production consent/PAT capture cases pass for
selected-card preservation, immutable receipt/snapshot witnesses, replay with
zero extra effects and foreign-owner denial. The full card/capture/race group
passes 18 cases; CI fixture corrections and error documentation pass 28 focused
core cases plus 38 MCP cases. This is source/isolated fixture proof.

The first card commit's CI exposed missing additive fixture metadata, an outdated
isolated numeric fixture, omitted error documentation and tied synthetic capture
timestamps. These were corrected without weakening their assertions. Fresh
committed-head CI/build evidence is tracked in PR #16 and remains required for
release. AWS renewal, live issuer/model/exporter acceptance, actual migration
adoption and the full original goal remain open. Candidate production npm
advisories are zero; development/infra findings remain in the release backlog.

Final source verification after the diagnosed fixes passes all 1,401 workspace
tests against retained migrated PostgreSQL, plus one deliberately skipped paid
live evaluation. The workspace comprises 21 bot, 133 extension, 59 MCP, 292 web,
23 worker, 24 API-client and 849 core cases. Workspace lint/types and whitespace
checks pass. This run used the shared heavy-check gate after the unrelated lock
holder ended and the source/fixture changes settled; it was not an unchanged
contention retry. Root stopped its PostgreSQL fixture with data retained.
Fresh committed-head bundle/smoke/CodeQL gates remain recorded in PR #16.
