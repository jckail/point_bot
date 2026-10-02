---
name: portfolio-review
description: Review the user's loyalty points portfolio - total value, balances by program, points about to expire, trip-goal progress, and the best next actions. Use when the user asks about their points, miles, balances, or "what should I do with my points".
---

# Portfolio review

Use the PointUp MCP tools (all read-only):

1. `pointup_get_portfolio_summary` - total points, estimated value, per-kind split.
2. `pointup_list_accounts` - per-program balance, 30/90-day trend, expiry.
3. `pointup_list_expiring` (withinDays: 180) - anything at risk.
4. `pointup_list_goals` - progress toward trips.
5. `pointup_plan_redemption` - ranked, step-by-step redemption plans (relay its caveats; availability is not verified).

Then answer in this shape, concise, no filler:

- **Total**: points and estimated value (note values are estimates, not guarantees).
- **At risk**: programs expiring soonest and the cheapest way to reset the clock.
- **Goals**: % complete and the gap.
- **Top 3 actions**: each with the reason and the number it moves.

If a balance looks stale (last update > 30 days), say so and offer the `capture-balance` skill. Never invent balances; if the portfolio is empty, offer to link programs (`pointup_link_account`).
