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
  this lineage. PR #14 migrations 0000–0015 and proposal-only 0016 are the
  integration history. Neither branch proves the deployed schema.
- Restore AWS authentication (`aws login`) and configure GitHub deployment
  role/Clerk secrets. No deployment credentials were available during this
  milestone. Keep production deploy distinct from source/CI completion.
- Supply an approved OpenAI project key through the web-only Secrets Manager
  secret and choose an explicitly available model. Activation and tracing are
  separate opt-ins. Prove inference and exporter/dashboard delivery with
  controlled fixtures before claiming live behavior.
- Inspect the production deploy verifier: its existing verification job lacks
  the PostgreSQL fixture used by pull-request CI. Align it with required
  integration checks before relying on it as the sole release gate.
- Configure alarm notification destinations and tune thresholds from actual
  traffic. Current alarms have no notification actions; cancellations remain
  in the started-run denominator and are excluded from the failure numerator.

## Remaining original overhaul work

- Integrate native SIWC account linking with this migration lineage. Approved
  ChatGPT OIDC client access and an independently verified ChatGPT session
  bridge remain separate prerequisites; linking alone does not complete sign-in.
- Port tenant-qualified goal membership with quarantine of invalid legacy
  associations; preserve valid goals and PR #14 features.
- Port observation-token versioning, consent/idempotency/replay provenance and
  audit fixes without fabricating provenance for historical observations.
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

## Working constraints

Root owns aggregate verification and all release operations. Expensive local
checks use `agent-heavy-check`, two workers, and a single owner; lock exit 75
is recorded without unchanged retries. Preserve other worktrees and processes.
The isolated proposal PostgreSQL fixture is root-owned and stopped after checks.
Agent Hub cannot map these worktrees to a memory scope, so curated repository
notes carry continuity. Shared Graphify currently lacks PointUp code coverage;
query it first, inspect current source, and refresh the whole shared corpus.
