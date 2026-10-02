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
  goal membership 0018. Observation 0019 remains proposed. Neither source
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
  full suite and aggregate CI for the new SIWC/goal source. Workflow commit `350ccc9`
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
- Implement [observation-integration-plan.md](observation-integration-plan.md)
  as additive migration 0019 and tightly scoped source changes. Retain existing
  observation IDs/outcomes, provider consent, auto-link scopes, `agent` balance
  source, outbox and retention behavior. Fix authorization/review checks at the
  write boundary, stable replay/provenance, and review cache invalidation;
  do not fabricate historical token/consent/snapshot provenance.
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
final-source aggregate CI follows the source commit.
These checks verify their source checkpoints and fixtures only.
SIWC is account linking for a signed-in Clerk user, not independent sign-in.
See [integration-status.md](integration-status.md) for the workflow run evidence.

## Working constraints

Root owns aggregate verification and all release operations. Expensive local
checks use `agent-heavy-check`, two workers, and a single owner; lock exit 75
is recorded without unchanged retries. Preserve other worktrees and processes.
The prior isolated proposal fixture is stopped. The current SIWC/goal PostgreSQL
fixture remains root-owned and will be stopped after root's final checks; other
agents must not clean up that fixture.
Agent Hub cannot map these worktrees to a memory scope, so curated repository
notes carry continuity. Shared Graphify currently lacks PointUp code coverage;
query it first, inspect current source, and refresh the whole shared corpus.
