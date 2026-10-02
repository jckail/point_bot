# Reviewed balance integrity — 2026-10-02

The captured-reading audit found a reproducible identity gap: capture a held
reading for membership A, change the same account to membership B without
changing its balance, then confirm. The original service recorded A's reading
against B. Owner, program and baseline-snapshot checks alone did not detect it.

New held receipts persist a private salted witness of the stored owner, account,
program and membership at submission. Confirmation checks it before writing and
passes it to the existing balance writer, which checks again after locking the
account. Changed, missing or malformed identity returns `REVIEW_STALE` before
snapshot, activity, receipt-transition or confirmation-event effects. Notes and
tags do not change identity. This binds the stored account; it does not attest
the provider page or replace the pending live-provider acceptance.

The witness is absent from public DTOs, action results, audit events and React
Flight props. Repository transitions preserve it. Older held rows without a
witness remain readable and rejectable but require a fresh capture to confirm;
no historical row receives invented identity evidence.

Migration `0022_observation_account_identity` adds one nullable JSONB column.
Apply it before the new runtime. Its journal entry uses actual wall-clock time
after entry 21, and snapshot 22 chains from snapshot 21 with only the new column
added. Existing rows, constraints and RLS policies are preserved. Mixed versions
are not qualified: old writers omit the witness and old confirmation code lacks
the guard. Rolling back to that runtime would reopen the identity gap; keep
confirmation disabled during an unqualified rollback or require a forward fix.
Production database lineage, backups and AWS activation remain separate gates.

Two related browser paths now preserve read-your-writes. Human confirm/reject
actions invalidate the user's portfolio cache in `finally`, matching the HTTP
routes even if an acknowledgement fails after commit. Expected errors from a
retained core service survive module reevaluation and receive bounded feedback;
unexpected repository errors still propagate. Canonical proposal-list refresh
reconciles succeeded actions before requesting a server-rendered portfolio
refresh, without resending approval or applying stale responses.

## Verification

- Corrected original-source identity comparison: six failures and 20 skipped
  cases. The membership case resolved as `recorded` instead of refusing it.
  An earlier test fixture lacked the lock capability required by atomic account
  edits; that initial failure is explicitly excluded as product evidence.
- Patched core: 66 passing cases across observation protection, composition,
  event emission and agent tests. The final-writer race uses the actual writer
  with a controlled fake read; it is not PostgreSQL lock-race proof.
- Original browser action source: five failures and three passes. Patched web:
  35 passing cases across real core/action cache tests, proposal-component tests
  and existing API/contract controls. Cache time is frozen, so TTL expiry cannot
  masquerade as invalidation.
- Original proposal component: five failures and 11 passes; all 16 patched
  cases pass. A documented hook harness runs actual component/effect/handler
  logic and request fencing, without claiming native React lifecycle or router
  delivery.
- Core/web typechecks, targeted lint and whitespace checks pass. Two additional
  PostgreSQL cases cover persisted identity with membership edits and a notes-only
  control; their execution and candidate/master release gates remain pending.

Native keyboard/lifetime/token acceptance from PRs 51–52 and captured-reading/
proposal lifecycle acceptance remain pending shared local capacity. A corrected
admission guard exits before launching when the repository scan fails or the
shared gate is occupied. A briefly started earlier owner launcher was stopped
cleanly (wrapper exit 0), proving its signal-cleanup fix but no frontend feature.
Owned server, PostgreSQL and browser resources are idle. Existing Graphify
excludes PointUp; the exact checkout index is stale and held on prior refresh
qualification, so the audit uses current source and actual test results.
