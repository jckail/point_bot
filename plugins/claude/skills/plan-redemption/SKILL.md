---
name: plan-redemption
description: Plan how to spend points for a trip - compare programs, transfer partners, and value per point, and show the gap to the goal. Use for "how should I book X" or "can I afford Y with points".
---

# Plan a redemption

1. `pointup_list_accounts` and `pointup_list_goals` for what the user has and wants.
2. `pointup_get_value_advice` for ranked transfer/redemption options.
3. Compute, for each candidate: points needed, points available (including transferable currencies), gap, and realized cents-per-point.
4. Recommend one primary plan and one fallback. Flag transfer risks (transfers are usually irreversible) and tell the user to verify award availability on the airline/hotel site before transferring.
5. If the user confirms a target, `pointup_create_goal` to track it.

Never initiate a transfer or booking yourself.
