---
name: plan-redemption
description: Plan how to spend points for a trip - transfers, split transfers, sweet spots, bonuses, and the gap to the goal. Use for "how should I book X" or "can I afford Y with points".
---

# Plan a redemption

1. Call `pointup_plan_redemption` with what the user named: `goalKind` (`flight`, `hotel` or `any`), `targetProgramId` (where it books, ids from `pointup_list_providers`), `quantity` (nights or tickets). It already reads their balances, custom valuations, expiring points and active transfer bonuses, so you do not need to compute transfers yourself.
2. Present the top plan and one fallback. For each: the exact steps (transfer X from A to B at the ratio, with any bonus and whether it is verified, then book Y), points used per source program, effective cents per point, and `shortfall` (points missing and which program could cover them via transfer).
3. Relay every `caveats` entry. Always say: award availability is NOT verified (unless the plan has an `availability` object), prices are typical ranges from an unverified catalog, and transfers are irreversible, so confirm space on the airline/hotel site BEFORE transferring.
4. If the user names a route and dates for a flight, pass `origin`, `destination`, `dateFrom`, `dateTo` and `cabin` together; availability is only attached when the deployment has award search configured, otherwise the result says `not_configured`. Never fill in availability yourself.
5. If the user confirms a target, `pointup_create_goal` to track it.

Never initiate a transfer or booking yourself, never quote a price as live, and never claim a transfer bonus that `pointup_list_transfer_bonuses` does not list.
