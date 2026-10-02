# Card-aware transfer eligibility

This is required follow-up implementation, not a completed feature. The full
PointUp overhaul remains active. Current Chase→Hyatt calculations apply a
universal1:1 edge and can falsely mark an award as fundable.

## Established problem and evidence

[Chase Preferred benefits](https://www.chase.com/sapphire-cards/personal/preferred)
and the [official transition announcement](https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred)
establish4:3 for affected Preferred/Ink products after the2026 transition. The
old Preferred grace period ended September30; relevant Ink products transitioned
October1. A40,000-point holding yields30,000 Hyatt points for those products,
not40,000. Reserve and other variants need readable primary verification before
claiming their current numeric rules. Amex checking-only eligibility is also
not equivalent to all Membership Rewards transfer access.

The graph's122 endpoints resolve to the190-provider catalog. This defect is
eligibility/calculation, not a missing destination or descriptive alias.

## Persist explicit product selection

Add a nullable cardProductId to the loyalty account domain and database, with
provider/product compatibility enforced in both domain and database. Existing
accounts remain unknown; never infer card ownership from notes, tags, membership
numbers, page text or historical balances. Under the one-account-per-provider
model this field identifies the card selected for a transfer, not a card number
or a separate points balance. A holder of multiple cards chooses explicitly.

Carry selection through repository writes/reads, read models, link/update
contracts, API serializers/client and export/import. Omitted updates preserve
selection; null clears it. Retain ownership authorization. Automated captures
and routine balance updates preserve selection.

## Resolve before any numeric calculation

Use one effective-dated resolver taking a transfer edge, account product context
and evaluation time. Return either a resolved ratio with rule/source/effective-
date metadata, or an unavailable reason. Unknown/unverified products do not
silently assume1:1 or4:3 for conditional edges. Verify historical rules as well
as current rules before supporting historical evaluation dates.

Use a resolved-edge type and runtime guard so unresolved conditional edges
cannot reach convertPoints. Replace the optimizer's module-static destination
graph with the graph resolved for that run. Apply identical resolution to:

- Funding allocation, inverse coverage/shortfalls and displayed transfer steps.
- GetValueAdvice rankings and estimated value.
- Assistant grounding hints, which must not repeat the unconditional yield.
- Account→holding mapping in PlanRedemption, which currently drops product context.

Direct destination-program holdings remain usable without source-card context.
Transfer bonuses and safe/exact rounding must compose with the resolved ratio.

## Complete the user path and rollout

Add product selection to account linking and editing, including Unknown. Show
selection and applicable effective rule alongside advice. An unavailable rule
needs an actionable explanation near advice and optimizer results. Do not use
notes as a surrogate field or merely append a warning after computing1:1.

Use an additive nullable migration with no inferred backfill. Update managed
manifest/journal and physical readiness verification, including the new column
and compatibility constraint. Migrate before writers. Retire older advice/worker
versions that continue applying unconditional ratios; CI alone does not prove
that production has done so.

## Required meaningful verification

- 40,000 affected-card UR yields30,000 Hyatt; it cannot alone fund a40,000 award.
- Funding, inverse shortfalls, rankings and assistant hints agree with bonuses
 and rounding, and with independently verified effective-date boundaries.
- Unknown/unverified products cannot produce a fundable conditional transfer.
- Selection survives real PostgreSQL reads/writes, omission/null edits,
 export/import and restoration; foreign owners cannot change it.
- Notes/tags naming Reserve or legacy never change eligibility.
- User selection changes the actual returned plan; unrelated transfers and
 direct Hyatt holdings remain intact.

Source anchors: core domain loyalty-account/optimizer/transfer-ranking,
application loyalty assistant/plan-redemption, repository/schema/contracts,
API-client and web link/edit/optimizer flows. Inspect current files and coordinate
ownership before implementation. Root retains migrations/aggregate verification
and release ownership. Primary-provider and controlled live acceptance remain
separate gates from local source/fixture verification.
