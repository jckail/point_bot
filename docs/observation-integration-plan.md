# Observation provenance, replay, review, and retention integration

Status: implemented in the integration source, with additive managed migration
`0019_observation_provenance_replay`; production adoption and final aggregate CI
remain pending. This records the implementation following the earlier audit at
`6a72b1b`. It does not replace the original release scope or the separately verified
identity/goal milestone. [Client behavior](observation-client-plan.md) and
[release gates](release-backlog.md) remain part of this stage.

Graphify was queried first during the audit and lacked relevant PointUp code
coverage. Findings and this implementation record use live source. Agent Hub
cannot resolve these worktrees to a configured project scope. No provider or
browser execution is claimed by local fixtures.

## Preserved behavior

The skill-based capture path retains per-user/provider consent,
`observations:write`, browser/computer skills, MCP submission, extension recording,
and human review. Auto-linking still additionally requires `portfolio:write` or
session authority. Existing outcomes remain `recorded`, `unchanged`, `needs_review`
and `rejected`; server-issued observation/review IDs and all existing required
response fields are preserved. Optional `observationId` identifies the same
server-issued receipt even when no review is needed.

First-reading caps and the existing 10×/zero-boundary guard remain. Confirmation
expires after 24 hours and rejects stale baselines; owner rejection remains
available after expiry as harmless cleanup. A retry cannot confirm a held value.
Confirm/reject require a browser cookie session, reject every Authorization header,
and retain same-origin protection and bodyless compatibility.

Balance effects still use `RecordManualBalance` with `source: 'agent'`, producing
`balance_agent` activity, inactivity-expiry updates and the existing `balance.recorded`
outbox event. Held/confirmed/rejected events remain in the same ambient transaction.
No native standalone snapshot/activity writes or replacement native status names
were introduced. Direct manual/sync and existing scoped agent capabilities remain.

## Protected authorization and transaction

`SubmitObservation` requires an atomic UOW and the repository's protected ports.
Production composition shares one ambient `DrizzleUnitOfWork` handle across
repositories and the publisher. Unsupported non-atomic hosts fail before writes;
unit fixtures explicitly roll back account, balance, activity, receipt and event
state rather than advertising an unimplemented atomic flag.

The protected submission port serializes the owner/capture replay key, locks the
PAT when applicable, takes the owner/provider advisory lock, locks the active
owned account and selected provider consent, and rechecks authorization after
blocking reads and before commit. Current PAT owner, revocation, expiry and scopes
are authoritative; an old HTTP `canLinkAccount` flag cannot bypass the current
`portfolio:write` check for auto-linking. Session/verified Clerk bearer captures
remain admitted through trusted resolver metadata. Every replay passes current
route authentication and current locked PAT/grant authorization first.

The shared account write boundary serializes observation, manual and sync snapshot
writers. Manual ownership/baseline reads move inside the UOW; sync refreshes account
state under the shared lock. Reviews lock the owned account and receipt, then check
live expiry and baseline inside the transaction. Expiry after a wait or write
rolls back the snapshot, transition and events. A failed outbox write also rolls
back the complete effect; the old compensation that reopened a possibly committed
review is removed.

Source: [service](../packages/core/src/application/agent/submit-observation.ts),
[protected repository](../packages/core/src/infrastructure/repositories/drizzle-agent-repositories.ts),
[shared balance/account adapter](../packages/core/src/infrastructure/repositories/drizzle-loyalty-account-repository.ts),
[manual balance](../packages/core/src/application/loyalty/record-manual-balance.ts),
[sync balance](../packages/core/src/application/loyalty/sync-loyalty-account.ts),
[ambient UOW](../packages/core/src/infrastructure/outbox/drizzle-outbox.ts).

## Canonical replay and receipt resolution

The strict wire contract adds optional caller UUID `captureId` and optional
`sourceMethod` (`page_capture`, `manual_entry`). A caller key is distinct from the
server receipt/review ID. Omitted keys keep legacy admission semantics and do not
promise stable replay recovery.

A partial unique index qualifies capture keys by owner. Under that key's lock,
exact retries return the existing receipt without another snapshot, audit row or
event. Changed claims conflict with the closed `OBSERVATION_REPLAY_CONFLICT` 409.
The versioned canonical hash includes the resolved account/provider, skill/version,
points, source claim, agent label, method, observed-time claim and membership-number
claim or its omission. It excludes credential identity and authority flags.
Omitted `observedAt` uses a stable omission marker; the original receipt time stays
unchanged when the server clock advances. Full URLs and membership numbers are
not persisted in the observation row; only the digest and bounded host remain.

Same-owner exact replay may use a rotated credential only after current
credential/grant authorization. The receipt retains its original credential,
consent and capture witnesses. Revoked/expired credentials or absent active consent
cannot obtain a replay success by bypassing authorization.

A held receipt can later become recorded or rejected through human resolution.
Replay returns that **current authoritative outcome**, with `reviewId: null` after
resolution; it does not regenerate actionable pending state. The original capture
claims/fingerprint remain unchanged. Repeat review calls retain the existing
`REVIEW_ALREADY_RESOLVED` error contract.

Source: [domain](../packages/core/src/domain/agent/observation.ts),
[wire contracts and safe DTO projection](../packages/core/src/contracts/agent.ts),
[capture HTTP route](../apps/web/src/app/api/v1/agent/observations/route.ts),
[error registry](../packages/core/src/domain/errors.ts).

## Provenance, baseline and legacy boundaries

The HTTP resolver supplies trusted `credentialKind`/PAT ID; caller JSON cannot
supply those fields. `agent` remains a display label, not authenticated provenance.
New authenticated receipts record version 1, credential/grant witnesses, catalog
version, self-reported method (`unknown` when omitted), hash/key, baseline and
recorded snapshot IDs, and review deadline/decision/time. Capture times must be
finite and nonfuture for every outcome; points must be nonnegative safe integers.
Existing backfill policy is preserved rather than imposing native's 30-day limit.

Skill hosts are exact reviewed catalog values: apex, www and the seeded start-URL
host; arbitrary subdomains no longer pass. Source claims require HTTPS without
userinfo or nondefault ports. Host/time/method claims still do not prove a provider
page was visited or that the value is correct. Catalog entries remain visibly
unverified until reviewed against the actual provider.

`executeWithSnapshotId` returns the exact generated snapshot ID while existing
`execute` keeps its public balance response. Backdated captures therefore never
infer the recorded snapshot from whichever row is latest. Version-1 reviews and
new internal receipts with known hashes compare the exact baseline snapshot ID,
including the absence of a prior baseline. Legacy version-0 rows with SQL NULL
hash/baseline fields keep the prior points comparison inside the protected
transaction. Historical credential/consent/snapshot provenance is not invented.

Confirmation invalidates the owner's read-cache tag in `finally`. Response DTOs
explicitly whitelist public result fields and optional receipt ID; private
credential, consent and hash witnesses remain server-only.

## Managed migration 0019 and retention

Migration 0019 appends 17 provenance/replay/review columns to `agent_observation`,
owner-qualified replay uniqueness, a reusable account identity index and
version-aware checks. Existing rows retain `provenance_version = 0` and unknown
witnesses; pending legacy review deadlines are backfilled from creation plus
24 hours. Migrations 0000–0018 and existing outcomes/IDs remain intact.

The composite `(account_id,user_id,provider_id)` owned-account FK is installed
**NOT VALID**. It enforces new/changed references but does not establish that every
retained historical row is owner/provider-consistent. Legacy mismatches are retained
rather than silently reassigned/deleted. Inspect and resolve them before separately
validating the constraint; neither metadata checks nor a fresh database proves a
populated production database has no such legacy rows.

Token, consent and snapshot witness IDs are durable scalars without FKs to the
purged credential/grant tables. Existing token/consent retention therefore continues
without erasing observation witnesses or causing purge failures. Scheduled retention
still omits balance snapshots and observation receipts and preserves dead-lettered
outbox rows. Account physical erasure retains its existing cascading behavior;
this audit does not promise survival across deliberate account deletion.

Source: [migration 0019](../packages/core/drizzle/0019_observation_provenance_replay.sql),
[schema](../packages/core/src/infrastructure/db/schema.ts),
[retention policy](../packages/core/src/infrastructure/retention/retention.ts).

## Verification checkpoint and remaining gates

Root's actual PostgreSQL runs passed **44 cases**: 18 migration/adoption, 23
production-composed observation cases and three retained integration cases. Managed
migration through 0019 passed. Nine focused sync/host checks passed: three new
shared-boundary regressions, four retained sync cases and two new exact-host policy
cases. Full root lint and all workspace TypeScript checks passed on the current
source. Backend unit tests cover replay/rotation/resolution, SQL-shaped legacy NULL
fallback, exact backdated snapshot IDs, expiry after waits/writes and rollback.
Caller mocks verify request/state behavior, not database atomicity or Chrome execution.

The production run includes all five additional authorization/review race cases.
The first gated suite found only a missing replay-conflict 409 documentation row;
root corrected it and seven focused error-code checks passed. The subsequent full
gated workspace run passed **834 tests**, with one paid live evaluation skipped.
Fresh aggregate CI after the source commit remains pending. This verifies current
source and isolated fixtures, not production state. Root remains the sole owner
of aggregate checks, PostgreSQL fixtures, Graphify refresh, commits and deployment.
The root-owned fixture is stopped with data retained after checks. Do not rerun
broad checks from another agent.

Before activating schema-dependent hosts, inspect the real deployment journal and
legacy data, verify a recoverable backup, adopt/apply migration 0019 and resolve
migration-before-host activation. Valid AWS/GitHub credentials, live Clerk/OpenAI
and Chrome checks, exporter delivery, approved-client sign-in policy, public OAuth
MCP/plugin publishing, staged broader numeric/RLS work and provider partnerships
remain in [release-backlog.md](release-backlog.md). iOS remains deferred.
