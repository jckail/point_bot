---
name: find-deals
description: Find deals and the best way to use the user's points - current transfer bonuses, curated award sweet spots, and ranked plans for their own balances. Use for "any good deals", "what's the best use of my points", or "is there a transfer bonus".
---

# Find deals and use points optimally

Be honest first: the catalog is editorial and unverified, bonuses are crowd or manual data, and award availability is not checked unless a plan says so.

1. `pointup_list_transfer_bonuses` - active bonus windows. Usually empty; if so, say there are none on record (do not guess). For each, say its source (manual, scraped, user) and whether `verifiedAt` is set.
2. `pointup_plan_redemption` (goalKind `any` unless the user wants a flight or hotel) - ranked plans over their real balances. Lead with the best plan's steps, effective cents per point and net value, then the next two.
3. `pointup_list_sweet_spots` (optionally `kind` or `programId`) - when the user wants to browse patterns they do not have enough points for yet. Describe costs as typical ranges.
4. Expiring points: if the result's `expiringHoldings` has entries, say which plan uses them (`usedByPlan`) and how many days remain.
5. If the user reports a bonus they saw (with a link), `pointup_record_transfer_bonus` after confirming the details back to them. It is stored unverified and affects plans for every user, so require a source.

Always close with the caveats from the plans: verify availability on the provider site before any transfer, because transfers are irreversible. Never transfer, book, or redeem for the user.
