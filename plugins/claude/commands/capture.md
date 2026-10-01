---
description: Capture a balance from a provider site into PointUp (needs consent)
argument-hint: <provider id, e.g. united | all>
---

Run the `capture-balance` skill for: $ARGUMENTS

If the argument is `all`, call `pointup_list_skills`, take every skill that is linked with `consentActive: true`, and delegate to the `balance-collector` agent. Do not request consent for `all` - list the programs that still need it and ask the user.
