# PointUp release backlog

The original full overhaul goal remains active. Preserve PR #14's functionality,
the native PR #15 work and combined PR #16 while completing the frontend/backend/
data audit, genuine identity and assistant integrations, provider/developer access
and production release. iOS remains deferred. Implemented source is summarized in
[integration-status.md](integration-status.md); the priorities below are remaining
work, not a request to remove capabilities or substitute read-only features.

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

The combined overhaul is merged to `master` at
`cab150cc2eabcf9765350a1a4d39d5bb944ee95b` through
[PR #16](https://github.com/jckail/point_bot/pull/16); PR #14's ancestry is included.
The separate native PR #15 is retained. The exact merged tree passed all six
release verification jobs in
[Deploy 37019388599](https://github.com/jckail/point_bot/actions/runs/37019388599)
and [CodeQL 37019387403](https://github.com/jckail/point_bot/actions/runs/37019387403).
AWS deployment was explicitly skipped because `AWS_DEPLOY_ROLE_ARN` is absent.
This is a verified source release, with production activation still outstanding.

The subsequent polish release is merged at
`b822241b234be9cee1381863c817f16cf16fff01` through
[PR #31](https://github.com/jckail/point_bot/pull/31). All six merged-source
verification jobs in [Deploy 37023995105](https://github.com/jckail/point_bot/actions/runs/37023995105)
and [CodeQL 37023993699](https://github.com/jckail/point_bot/actions/runs/37023993699)
passed, covering 1,608 workspace tests plus one paid live skip. Its AWS job was
also skipped for missing deployment-role configuration.

The claim/identity/goal safety release is merged at
`e3e33b5d6a98ffe416af180c98b0b3aca909ff29` through
[PR #32](https://github.com/jckail/point_bot/pull/32). Its six merged-source
verification jobs in [Deploy 37029520512](https://github.com/jckail/point_bot/actions/runs/37029520512)
and [CodeQL 37029519862](https://github.com/jckail/point_bot/actions/runs/37029519862)
passed, with 1,687 workspace tests plus one paid live skip. AWS remains skipped
for missing deployment-role configuration. The next recovery polish adds an
always-available Chrome proposal-review control and bounded observations for
actual stalled-execution recovery; preserve uncertainty and support references.
Pending expiry/rejection telemetry now follows exact conditional-transition
receipts, including expiry after a claim waits for its row lock. Repeated/concurrent
losers emit no receipt event. Durable audit delivery remains open; a process crash
after database settlement can lose best-effort telemetry.

Recovery polish [PR #33](https://github.com/jckail/point_bot/pull/33) is merged at
`d65b0f1dd585c1ef9a5f54dcbe4cefb5a41ae271`. Its six master verification jobs
in [Deploy 37030692963](https://github.com/jckail/point_bot/actions/runs/37030692963)
and [CodeQL 37030692749](https://github.com/jckail/point_bot/actions/runs/37030692749)
passed with 1,694 workspace tests and one paid live skip; AWS deployment remains
skipped. The prior native build queue failure (exit 75) was followed by a successful
wrapped build after contention cleared and bounded actual Chrome popup acceptance.
See [native acceptance evidence](chrome-extension-acceptance.md); provider/API/model
and worker-termination behavior remain unverified.

CSV portability/cancellation [PR #34](https://github.com/jckail/point_bot/pull/34)
is merged at `7e4a5b23cdb7d1cc6bb91c17f267f2b70fff136a`. Its six master verification
jobs in [Deploy 37033664518](https://github.com/jckail/point_bot/actions/runs/37033664518)
and [CodeQL 37033664139](https://github.com/jckail/point_bot/actions/runs/37033664139)
passed with 1,707 workspace tests and one paid live skip; AWS remains skipped.

**Verify local extension endpoint acceptance in Chrome.** The manifest now grants
HTTP for exactly `localhost`, `127.0.0.1` and `[::1]`, matching accepted settings
without changing frozen pending-capture identity. All 35 focused alignment/retry
tests passed; the wrapped rebuild timed out in the shared verification queue
(exit 75). PR #35 CI built the candidate. A separate minimal native Chrome probe accepted
both new patterns and fetched a real no-CORS-header fixture over all three hosts;
see [bounded probe evidence](chrome-extension-acceptance.md#native-loopback-permission-probe).
Actual PointUp endpoint authentication and native candidate application installation
remain open.

The current owner-change UI follow-up keys both `/dashboard/agents` management
and proposal-review panels by the authoritative owner, remounting on owner change
and preserving local state for same-owner refresh. Source review and focused
lint/types passed; controlled native fixture execution was blocked by the shared
verification queue (exit 75), without an unchanged retry. Native lifecycle and
live Clerk owner switching remain acceptance gates.

## Immediate release gates

**Deploy the reviewed-action and goal mutation fixes together.** Manual-balance
proposal payloads now store a private identity witness in existing JSONB, removed
before public DTO validation. Retire old proposal readers/writers before enabling
new proposals: old strict readers do not understand the reserved private field.
Pending legacy manual proposals without identity evidence must be replaced with
a newly reviewed proposal. No schema migration or bulk historical rewrite is
needed. Keep the atomic production UnitOfWork and account/goal locks composed;
verify a membership change during review produces no balance/activity/outbox
write. Goal references now count once and omitted references preserve current
associations. Focused PostgreSQL evidence covers six goal and three assistant
identity cases; hosted rollout remains unverified.

**Roll out card-aware transfer eligibility before activation.** Source now persists
an explicit nullable transfer card, uses the shared dated resolver in rankings,
funding, inverse coverage and assistant grounding, and exposes selection/warnings
in the web UI. Verified affected Preferred/Ink/Corporate products use 4:3 from
October 1, 2026; unknown and Reserve rules remain unavailable. Do not infer
selection from notes or capture text. See [implementation and evidence](transfer-eligibility-plan.md).
Deal affordability must use the same resolver and visible bonuses rather than
compare source points directly to a destination cost or assume a route exists.
The current follow-up returns exact source requirements, missing-route/card
warnings and unverified-limit caveats through the advice contract. Scraped signed
or accounting prices must remain unstructured and cannot raise award-watch values;
provider-label heuristics must preserve explicit redemption destinations. Retain
the new actual-use-case regressions and verify the follow-up's exact committed head.
Apply additive migration 0021 before writers and retire old advice/worker versions
that calculate an unconditional 1:1. Source/fixture verification does not prove
production has adopted this fix. Verify remaining card variants and Amex checking-only
eligibility against primary terms before adding their numeric rules.

1. Preserve the exact verified release candidate and complete its production gates.
   Previous verified Southwest runtime `fe36202b738906fdecf0ca346a586c0cd1534c98`
   passed all six [CI 37003135680](https://github.com/jckail/point_bot/actions/runs/37003135680)
   jobs and [CodeQL 37003135711](https://github.com/jckail/point_bot/actions/runs/37003135711),
   covering 1,332 workspace tests plus one paid live skip, managed 0020/attestation,
   all bundles/contracts/HTTP MCP and Docker direct/PgBouncer smoke. The card-aware
   successor includes migration 0021, atomic account/import fixes and actual
   consented capture/race regressions. Fresh exact-source CI evidence is recorded
   in PR #16; verify that candidate rather than adopting an older unconditional
   advice runtime. These passing checks do not establish production activation
   or live issuer/model/exporter behavior.
2. Local AWS STS responded on October 2, superseding the earlier expired-session
   result. Read-only us-east-1 inspection found the existing legacy PointUp Elastic
   Beanstalk environment and no managed PointUp ECS stack among completed stacks.
   GitHub secrets and environments still list none. Configure the authorized
   deployment role/application secrets and protected production environment; verify
   the actual deployment target, account/region,
   stack ownership, deployed IAM and certificate/DNS/public HTTPS origin configuration.
3. Inspect actual staging/production journals, tables and data before adopting managed
   history through 0021. Establish an approved recoverable backup and restore rehearsal,
   compatible adoption path and any required write/drain window. No source branch or
   fixture proves deployed lineage. Diagnose migration 0018 lock contention before any
   deliberate retry; its archival lock timeout is 30 seconds.
4. Exercise the implemented migration-first release flow against the real environment:
   immutable images/template, protected existing resources, exact candidate task/manifest,
   pre-SQL journal prefix, locked post-migration attestation and schema readiness, then
   host/schedule activation. First creation must remain inactive; later readiness
   attestation must be genuine. Retain release/task/log references and rollback assets.
   CloudFormation rollback does not restore PostgreSQL. See
   [rollout plan](production-rollout-plan.md) and [review](production-rollout-review.md).
5. Verify hosted readiness, authenticated smoke, Clerk sessions/callbacks, optional MCP
   routing and configured feature secrets before enabling them. Configure alarm
   notification destinations and tune thresholds from real traffic; current alarms
   have no notification actions. Verification-only success does not establish AWS
   deployment or event delivery.

## Historical data, provenance and retention

- Audit historical simulated balances using reviewed deployment/configuration and
  adapter evidence. Old simulation and genuine sync both used source `sync`; that
  value alone is insufficient to identify or delete rows. Preserve recoverable data,
  document unresolved provenance and review any quarantine/repair policy explicitly.
  The new gate prevents future implicit simulation; it does not repair old readings.
- Inspect legacy numeric violations, tenant/provider ownership mismatches and goal
  adoption quarantine against the actual deployed lineage. Repair with reviewed
  evidence, then separately validate staged NOT VALID constraints. Preserve tags,
  ordered goal membership, review IDs/outcomes, unknown historical witnesses,
  `agent` balance source, activity/outbox and account expiry metadata. Continue
  atomicity/RLS and remaining rate/deal/cash boundaries review; do not hide invalid
  history with global clamping. See [numeric integrity](numeric-integrity-plan.md)
  and [observation plan](observation-integration-plan.md).
- Candidate 3701309 stores only generated-reference diagnostics for new outbox
  failures; historical raw exception text remains until a reviewed scrub. Define and
  implement an auditable scrub, finite dead-letter retention/replay window, backup-
  retention policy and any DTO/access review. Existing processed-event retention is
  not proof that pending/dead-letter rows or backups expire. Preserve retry/delivery
  semantics and useful nonsecret correlation; test real retention/replay boundaries.
- Extend durable proposal audit delivery. Pending expiry/rejection and stale
  execution recovery now emit bounded metadata from actual-transition receipts,
  but a crash between persistence and emission can lose best-effort events. The
  success journal is authoritative; metrics/logs do not prove
  completion. Verify production outbox delivery and observation replay/review recovery
  after deployment, preserving current credential/grant rechecks and original witnesses.
  Award-watch checks now lock and reread the current row after scraping, preserving
  newer success/timestamps through delayed failures and serializing notifications
  with outbox writes. Deleted or changed configurations cannot publish stale hits.
  Root verified four actual PostgreSQL lock barriers; this does not prove production
  scheduling or event delivery. Preserve this atomic composition during rollout.
  Outbox outcome writes now require the original attempt and lease deadline,
  preserving newer claims and terminal rows while suppressing stale outcome
  counts/hooks. Root verified 14 actual PostgreSQL cases. Retire old unfenced
  consumers before treating production outcome fencing as established. Handler
  delivery remains at least once; dead-letter retention/replay and historical
  exception scrubbing are still separate outstanding policies.
  Public-share lifetime now rejects nonempty invalid values consistently in browser,
  HTTP and core callers; snapshot resolution rechecks current token/owner/revocation
  and expiry after loading portfolio data. Redemption funding now reads portfolio,
  selected card and owner-visible bonuses after optional award search and filters
  windows at evaluation time, preventing an expired bonus from funding a plan. Exact account deadlines are treated as
  expired instead of rounded negative zero. Focused gated use-case tests cover these
  changes; production rollout and real concurrent database acceptance remain open.
  Calendar-month projections now clamp month-end dates rather than overflow into
  the following month. United MileagePlus's obsolete 18-month policy is corrected
  to no inactivity expiry using primary evidence. Existing dates are not bulk
  rewritten; reads/historical captures preserve them and forward activity keeps
  the existing policy-recalculation behavior. Audit the remaining editorial program
  policies and expiry provenance before repairing historical deadlines.

## Live assistant, Chrome and provider acceptance

- Configure an approved OpenAI project key in the web-only secret and choose an
  explicitly available model. Run the twelve-case synthetic live evaluation with the
  manual rubric and automated assertions; the paid evaluation is currently skipped.
  Prove inference, opt-in SDK trace export and dashboard/CloudWatch arrival independently.
  Keep default-off tracing, kill switch and private payload handling intact.
- Verify authenticated dashboard/chat/review and unpacked Chrome extension behavior
  with controlled portfolios: cancellation, late proposal persistence, explicit review/
  refresh, popup reopening during inference, account changes, service-worker lifetime,
  frozen capture retries, displayed-ID discard, review-tab reuse, focus and accessibility.
  Source tests and bounded layout checks do not prove browser/provider lifecycle behavior.
  Source follow-ups retain the last scoped capture receipt across popup reopening,
  normalize explicitly saved API origins consistently and preserve transcript DOM
  during unchanged polling. Cached proposal status is labeled as a snapshot.
  Owner-scoped web chat recovery now retains the bounded conversation/draft in
  tab-local sessionStorage for 24 hours and restores interrupted requests as
  uncertain without replay. Root's single isolated Chrome tab verified draft
  reload, interrupted navigation, stopped late responses and Clear/reload with
  synthetic requests. Real Clerk owner switching, extension service-worker
  lifetime and authenticated provider acceptance remain open.
- Verify the new program-specific bank capture candidate for Chase, US Amex,
  Capital One Miles and Bilt against controlled logged-in pages. Synthetic
  product/unit/region fixtures and exact hosts are implemented; current Capital
  One rewards-host compatibility remains unresolved. Extend regional Amex mapping
  explicitly rather than assigning international points to the US program.
  Catalog/rule presence does not prove live balances or award space.
- Pursue the documented issuer API partnership leads in [integrations.md](integrations.md).
  Amex merchant inquiry, Capital One dollar rewards and Bilt partner-point callbacks
  are not verified portfolio-balance readers; establish eligibility and actual
  balance/consent contracts before implementing those adapters. Verify configured
  aggregator access and truthful capabilities; retain consented manual/guided capture
  where no API is available. Review upstream currency/rate and remaining parsing bounds
  against real provider formats without exposing credentials or private response bodies.

## Genuine ChatGPT identity and eligible plan usage

- Validate existing SIWC owner linking with actual client access, canonical callback
  hosting and Clerk credentials. Linking is implemented; independent sign-in is not.
- Implement the standalone design after establishing approved website-client and Clerk
  custom-provider compatibility: subject-only authoritative owner mapping, reverified
  enrollment, immutable issuer/client/subject reconciliation, explicit new-user policy,
  MFA/enterprise/session controls, unlink/logout/revocation and adversarial tests. Do not
  email-auto-link or bypass normal Clerk policy with backend sign-in tickets. See
  [standalone design](chatgpt-standalone-plan.md).
- Assess open-source ChatGPT plan usage separately from website SIWC. Official dynamic
  per-user/workspace registration does not require a partner API key, but PointUp
  licensing/eligibility is unverified. Establish a supported local/self-hosted runtime,
  loopback callback and protected rotating-token storage outside browser storage; MV3
  storage or Chrome identity callbacks are not demonstrated substitutes. A native
  companion is a candidate requiring implementation/security review. Implement the
  compatible inference adapter and required registration/preview parameters before
  claiming plan-funded inference. No provider registration or plan usage is completed.
  The current official DevKit offers local OAuth/streaming and React controls as
  repository workspaces, but its noncommercial license is a separate adoption gate;
  it must not be assumed to inherit a future PointUp license. An inference-only
  companion can retain existing Clerk/PAT portfolio authority while standalone
  PointUp sign-in remains a separate capability. See the
  [current assessment](chatgpt-standalone-plan.md#current-devkit-assessment).

## Public MCP, plugins and developer onboarding

- Complete the [public MCP auth plan](public-mcp-auth-plan.md) with an established IdP
  compatible with existing Clerk owners. The disabled OAuth JWT adapter is unwired;
  mandatory issuer/resource audience, client, owner and scope verification must remain.
  Establish real resource issuance, client/redirect/PKCE/discovery compatibility and
  revocation behavior; reject opaque tokens until resource binding is proven.
- Wire a separate OAuth principal/backend authorization path without treating OAuth
  as a Clerk session or PAT. Begin with the reviewed read-only seam, preserving existing
  scoped PAT/direct mutation capabilities and browser-only approvals. Do not forward
  MCP-audience credentials to another resource without an authorized delegation design.
- Complete required metadata/tool challenges, public HTTPS hosting, onboarding/consent,
  plugin/Action publishing and live OpenAI client acceptance. Keep approval/rejection
  excluded from the generated Action spec. Offline verifier/tool tests do not establish
  real client authorization or hosted discovery.

## Continued audit and working constraints

Review remaining infrastructure/development dependency advisories and future advisories;
the last observed application production audit was clean. Continue the broader frontend,
backend, data and documentation audit with meaningful bounded regressions and compatible
additive changes. Preserve the full goal and deferred iOS boundary.

Root owns aggregate checks, PostgreSQL and release operations. Expensive checks use the
shared heavy-check gate and one verification owner; no unchanged contention retries or
lock bypass. Preserve stopped root fixtures/data and unrelated processes/worktrees.
Shared Graphify refresh succeeded with 164,478 nodes but PointUp coverage is absent;
query first and inspect current source. Agent Hub's project memory scope is unconfigured,
so curated repository notes carry continuity. This checkpoint claims no production mutation,
merge, live provider/model/exporter call or new browser execution.

A source audit verified all122 transfer endpoints resolve to the190-provider
catalog. It found an extension-specific Southwest alias defect: `southwest`
does not resolve; canonical `southwest-rapid-rewards` is required for both PAT
skill lookup and legacy linked-account matching. The focused follow-up is implemented and its committed-head CI passed; subsequent card-aware changes need their own exact-source gates. Preserve frozen historical captures; require explicit discard/recapture
instead of rewriting their identity/payload or automatically resubmitting.

## Current dependency audit follow-up

The application lock is updated to Vitest 4.1.11 with explicit workspace test
discovery and supported Vite 7.3.6. Same-family brace-expansion, browserslist and
js-yaml patches plus caller-scoped core-utils/esbuild and hyperid/UUID overrides
remove the observed application development findings. The settled application
audit reports zero findings, including development dependencies. A compatibility
script exercises the actual transform, UUID buffer/CommonJS, hyperid rollover and
bounded autocannon loopback callers in CI. Preserve clean-install and exact-head
CI evidence for the final candidate; an audit alone does not verify compatibility.
Do not replace these fixes with force-fix downgrades.

The separate infrastructure lock has vulnerable brace-expansion bundled inside
aws-cdk-lib. Its current 5.0.6 version matches six advisories (five high and one
medium). The proposed 5.0.9 version still matches two high advisories
([GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p),
[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7))
and one medium advisory
([GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)).
Dependabot PR #20's 2.271.0 and a reviewed 2.272.0 artifact still bundle vulnerable
brace-expansion 5.0.9, so simply upgrading to that artifact would not fix it.
Verify a genuinely patched CDK artifact and synthesized-template behavior;
a root override does not establish replacement of a bundled dependency. These
are deployment/development tooling findings, distinct from application production
dependencies and from GitHub's default-branch count. Container base OS/image
audit remains separate. This infrastructure finding is still open.

Fresh default-branch reconciliation found 75 open GitHub alerts: 69 belong to
the discontinued `legacy/python-selenium/Pipfile.lock`, including its sole critical
finding (Twisted 20.3.0), and six to the infrastructure package above. The application
lock audit, including development dependencies, remains zero; audited locks match
merged master. Preserve the archived source/evidence and establish a separate
reviewed archive/dependency policy. Do not imply that current application traffic
executes the archived Python stack, or delete the archive to hide alerts. Review
the new Dependabot candidates for compatibility; major Clerk/ESLint/Node/TypeScript
updates are not routine patch remediation.
