# PointUp release continuation

The active combined integration is `codex/pointup-integrate-20261001` in the
native worktree `/home/jkail/projects/point_bot-integration`, stacked PR #16 on
PR #14. PR #15 preserves the alternative native overhaul. Original native
checkout changes remain intact; avoid publishing its whitespace-only churn.
See [integration-status.md](integration-status.md) for verified evidence and
[assistant-agent.md](assistant-agent.md) for the shared SDK runtime.

## Next release gates

- Inspect actual staging/production migration journals and relevant tables;
  establish a recoverable backup and compatible adoption plan before applying
  this lineage. The integration history is preserved PR #14 migrations
  0000–0015, proposal 0016, SIWC storage/adoption 0017 and tenant-qualified
  goal membership 0018 and observation provenance/replay 0019. Migration 0019
  passed in isolated managed fixtures; production adoption remains unverified. Neither source
  branch nor fixture proves the deployed schema. Apply managed migrations
  before activating hosts that require their tables; the current workflow
  still deploys CDK hosts before its ECS migration step, so ordering remains
  a release gate. Migration 0018 has a 30-second transaction-local lock
  timeout; diagnose contention before any deliberate retry.
- Restore AWS authentication (`aws login`) and configure GitHub deployment
  role/Clerk secrets. Local AWS authentication is expired and deployment
  secrets remain absent. Keep production deploy distinct from source/CI
  completion; successful verification-only runs skip AWS writes.
- Supply an approved OpenAI project key through the web-only Secrets Manager
  secret and choose an explicitly available model. Activation and tracing are
  separate opt-ins. Prove inference and exporter/dashboard delivery with
  controlled fixtures before claiming live behavior.
- Complete final review fixes and their focused regressions, then await the
  fresh aggregate CI for the new observation source. The earlier SIWC/goal
  committed milestone already passed its complete gate. Workflow commit `350ccc9`
  already closes the earlier verifier gap by reusing the complete six-job
  gate: [CI 36976573470](https://github.com/jckail/point_bot/actions/runs/36976573470)
  and [verification-only Deploy 36976965575](https://github.com/jckail/point_bot/actions/runs/36976965575)
  passed, with AWS deployment/migrations skipped. Preserve that gate for release.
- Confirm the deployment/hosting route and public HTTPS `APP_URL`, Clerk
  session handling, approved OIDC client configuration and exact SIWC callback
  routing before enabling account linking. Linking does not establish an
  independent ChatGPT sign-in or an approved session bridge.
- Configure alarm notification destinations and tune thresholds from actual
  traffic. Current alarms have no notification actions; cancellations remain
  in the started-run denominator and are excluded from the failure numerator.

## Remaining original overhaul work

- Complete live SIWC account-linking validation once approved client access,
  callback hosting and Clerk credentials exist. Source linking and managed
  storage migration 0017 are implemented; approved ChatGPT OIDC client access
  and an independently verified ChatGPT session bridge remain separate
  prerequisites for independent sign-in.
- Rehearse tenant-qualified goal migration 0018 against the actual deployed
  lineage after journal/backup inspection. Source quarantine/ownership behavior
  is implemented and six real PostgreSQL goal cases pass, including concurrent
  membership-write blocking after the lock correction; deployment adoption
  remains unverified.
- Complete fresh aggregate CI and production adoption for the implemented
  [observation migration/protocol](observation-integration-plan.md) and
  [client recovery behavior](observation-client-plan.md). Current credential/grant
  locks, stable replay, exact snapshot witnesses and cache invalidation are in
  source, preserving IDs/outcomes, auto-link scopes, `agent` balance source,
  outbox and retention. Inspect retained legacy owner/provider mismatches before
  separately validating the NOT VALID FK; historical witnesses remain unknown.
- Add staged numeric constraints and complete remaining atomicity/RLS review;
  preserve account tags, the agent balance source, outbox and retention behavior.
- Verify the actual dashboard/chat/review UI and unpacked Chrome extension with
  Clerk and synthetic portfolios. Test cancellation, account changes, service
  worker lifetime and focus behavior in the browser. Reuse one tab per agent
  session; never take over unrelated agents' tabs.
- Run the ten-case synthetic live evaluation only with explicit configured
  inference credentials and a chosen model; apply the manual rubric as well as
  automated checks. Scripted SDK tests do not prove live model quality.
- Extend proposal audit coverage for pending expiry and stale execution recovery;
  current logs/metrics are observations, while the durable journal is authoritative.
- Review remaining infrastructure/development dependency advisories. The observed
  application production audit is clean; the bundled CDK brace-expansion advisory
  is still recorded separately.
- Finish hosted OAuth MCP/public plugin publishing and developer onboarding.
  Existing scoped PAT APIs and ChatGPT tools remain; browser approval endpoints
  are excluded from the Action spec.
- Pursue provider API/developer partnerships where available and retain guided
  capture/consented observation flows where API access is unavailable. Confirm
  live balances/award space rather than inferring them from mock adapters.
- Continue the broader frontend/backend/data audit and documentation cleanup.
  iOS remains deferred at the user's request.

## Latest local milestone evidence

Root-owned focused PostgreSQL fixtures pass 23 SIWC/goal cases (ten adoption,
six ownership, seven storage). All six goal cases pass after the migration lock
correction, including an actual concurrent membership-write blocking race. The
managed migration command passed, earlier full lint/all workspace types passed,
and Drizzle metadata showed zero drift. The full workspace suite passed 708 tests
with one paid live evaluation skipped **before** the OAuth callback CSRF fix;
53 focused callback/policy checks now pass, including 11 through the real shared
HTTP/authentication boundary. Final full lint and workspace types also pass;
exact runtime7c7cd11 then passed all six CI jobs36979098872 and CodeQL36979098961,
including721 workspace tests,13 infrastructure tests, all builds and Docker smoke.
These checks verify their source checkpoints and fixtures only.
SIWC is account linking for a signed-in Clerk user, not independent sign-in.
See [integration-status.md](integration-status.md) for the workflow run evidence.

## Current observation checkpoint

Migration 0019 and protected submission/review transactions are implemented;
managed migration through 0019 passed. Root's actual PostgreSQL checks passed
**44 cases** (18 migration/adoption, 23 production observation including five new
races, three retained integration). Nine focused sync/host checks and full root
lint/all workspace types passed. The initial gated workspace run found a missing
replay 409 documentation row; root corrected it and seven focused error-code tests
passed. The subsequent full gated workspace suite passed **834 tests**, with one
paid live evaluation skipped. Exact runtime `d9ffc38` passes all six CI jobs36983533954 and CodeQL36983533965;
these source/fixture checks are not a production deployment claim. The earlier
verified identity milestone above is preserved.

Current same-owner replay revalidates live credential/consent and preserves original
witnesses. Reviews use exact known snapshot baselines, retain legacy SQL NULL points
fallback and roll back expiry/outbox failures atomically. Extension frozen requests,
25-second uncertainty recovery and bounded tombstones are source-tested; live Chrome
lifecycle/provider behavior remains a separate gate. The owned-account FK remains
NOT VALID for legacy rows, and broader numeric/RLS review is still required.

## Working constraints

Root owns aggregate verification and all release operations. Expensive local
checks use `agent-heavy-check`, two workers, and a single owner; lock exit 75
is recorded without unchanged retries. Preserve other worktrees and processes.
The root-owned proposal, identity and observation PostgreSQL fixtures are stopped
with data retained after their checks; other agents must not clean up those fixtures.
Agent Hub cannot map these worktrees to a memory scope, so curated repository
notes carry continuity. Shared Graphify currently lacks PointUp code coverage;
query it first and inspect current source. The whole-corpus refresh completed
(164,478 nodes), with the PointUp coverage gap still present.

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
