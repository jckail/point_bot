---
name: expiry-rescue
description: Find loyalty points that will expire soon and recommend the cheapest activity to keep them alive. Use when the user mentions expiring points/miles or inactivity.
---

# Expiry rescue

1. `pointup_list_expiring` with `withinDays: 365`.
2. For each result, state: program, points, days left, and the inactivity policy (from `pointup_list_providers`).
3. Recommend the lowest-effort qualifying activity per program (a shopping-portal purchase, a small card spend, or a partner earn). If unsure what qualifies for a program, say so and link the program's terms rather than guessing.
4. Offer to create a goal or note on the account (`pointup_create_goal`) so it resurfaces.

Order the answer by days remaining, soonest first. Keep it to one line per program plus the action.
