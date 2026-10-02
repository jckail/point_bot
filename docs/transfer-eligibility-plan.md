# Card-aware transfer eligibility

The integration worktree implements explicit account selection, persisted storage,
shared effective rules, API/assistant propagation, web selection/warnings and
additive migration 0021. Controlled PostgreSQL tests verify persisted selection,
ownership, omission/null edits, stale routine updates, export/import, restoration
and actual selected-card changes to returned funding. Production rollout and
live issuer acceptance remain open. The prior universal Chase→Hyatt 1:1
calculation could falsely mark awards as fundable.

## Established problem and evidence

[Chase Preferred benefits](https://www.chase.com/sapphire-cards/personal/preferred)
and the [official transition announcement](https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred)
establish 4:3 for affected Preferred/Ink products after the2026 transition. The
old Preferred grace period ended September 30; relevant Ink products transitioned
October 1. A 40,000-point holding yields 30,000 Hyatt points for those products,
not 40,000. The readable [Reserve program agreement](https://www.chase.com/sapphirereserve/rewardsagreement)
allows combining points among eligible own/household cards but does not publish
a numeric Hyatt ratio. Reserve remains unverified in the resolver; generic
transfer access and omission from a change announcement do not prove 1:1. Amex checking-only eligibility is also
not equivalent to all Membership Rewards transfer access.

The graph's 122 endpoints resolve to the 190-provider catalog. This defect is
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
silently assume 1:1 or 4:3 for conditional edges. Verify historical rules as well
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
notes as a surrogate field or merely append a warning after computing 1:1.

Use an additive nullable migration with no inferred backfill. Update managed
manifest/journal and physical readiness verification, including the new column
and compatibility constraint. Migrate before writers. Retire older advice/worker
versions that continue applying unconditional ratios; CI alone does not prove
that production has done so.

## Required meaningful verification

- 40,000 affected-card UR yields 30,000 Hyatt; it cannot alone fund a 40,000 award.
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

## Application and transport implementation

`PlanRedemption.toHoldings` carries the persisted nullable `cardProductId` into
funding inputs. `GetValueAdvice` and legacy assistant grounding call the same
`rankTransferAdvice` resolver with each account's explicit selection and one
shared evaluation time. They return eligibility warnings independently of the
ranked options, so an excluded transfer remains explainable. Native SDK
`value_advice` tool output retains those warnings. Legacy model grounding
includes their fixed messages and instructs the model not to invent a ratio or
combine cards automatically. No membership number, tag, note or capture changes
product selection.

Account HTTP POST/PATCH forwards the shared validated field under the existing
owner and `portfolio:write` authority. Omission preserves selection; explicit
null clears it. The API client already sends the shared request DTO unchanged.
The composition accepts an optional clock and forwards it to account reads,
active bonuses, planning and advice for coherent effective-date evaluation.

Known selected Preferred, Ink Business Preferred, Ink Plus and Corporate Flex
use the officially supported 4:3 rule from October 1, 2026. Historical windows
remain unsupported until their exact account-date inputs/rules are established.
Unknown and Reserve selection cannot create a numeric Hyatt transfer estimate.
Direct Hyatt holdings and unrelated unconditional transfer edges remain usable.
The one-account-per-provider model selects the card used for transfer; it does
not represent separate card balances or independently establish issuer access.

Focused application verification covers 40,000 UR yielding 30,000 Hyatt and
39,000 with a synthetic 30% bonus, shared ranking/hint calculations, insufficient
funding for a 40,000-point award, unknown/Reserve exclusion and model guidance.
HTTP/client tests cover selection/null/omission, existing owner/write scope and
unknown enum rejection. SDK tool transport retains excluded-transfer warnings.
These are local controlled tests, not issuer-account or production evidence.

## User flow and database evidence

Choose a transfer card when linking Chase Ultimate Rewards, or edit it under
account Details → Transfer card. Unknown clears the explicit selection. Advice
and optimizer results show actionable unavailable-route warnings and applicable
card/ratio/date/issuer source. Refreshed server advice supersedes prior imported
client advice after account changes. CSV imports reject explicit unknown or
differing selections conflicting with an existing card; older omitted columns
preserve selection. Routine account updates omit this database field so a stale
balance/notes aggregate cannot overwrite a newer choice or clearing.

Eleven actual migrated PostgreSQL cases pass for account/card persistence and
provider compatibility, including agent/manual writes, restore/export/import,
foreign-owner denial, stale writes, 40,000 insufficient points, 54,000 fundable
points and unknown exclusion. Physical attestation tests reject missing card
column/CHECK, incorrect type and non-nullability with an unchanged journal.
No live transfer, paid model call, exporter delivery or production activation
is established by these tests.

## Atomic mutation and actual capture verification

Account edits, unlink and restoration recheck the current owner/state after
locking the row in the transaction. Omitted metadata is applied from that
current row. Import locks providers in sorted order and validates current card
selections before any write; all links and balance effects join the same unit
of work. Five real PostgreSQL barrier tests verify these concurrency paths.
Two more tests exercise actual consent, PAT authority, SubmitObservation and
persisted receipts, preserving selected cards across exact replay and rejecting
foreign credentials/owners with no extra effects. These extend the earlier
agent-source balance test with actual production capture authorization/provenance.
