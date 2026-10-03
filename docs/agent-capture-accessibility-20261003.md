# Agent capture context and stable action feedback

The agents dashboard now projects the public capture time separately from submission time. Pending review and receipt history render semantic time elements in explicit UTC, and review buttons include their own action, provider/points summary and capture time in their accessible names. Private account witnesses, membership values and source queries remain outside the page projection.

Successful review, token revocation and consent revocation publish feedback in stable section status regions even when revalidation removes the corresponding row. Focus handoff requires a genuine successful ActionResult, authoritative row absence and an eligible initiating interaction. One shared focus-intent ledger across sections cancels handoff after a newer operation, subsequent key interaction, outside pointer/focus interaction or window blur. Failure and unmount clean up eligible listeners. Errors remain with their actual action result; row disappearance alone never fabricates success.

The added renderer cases exercise actual core capture/review use cases, the actual dashboard projection and panel SSR for distinct historical capture times, accessible row context, populated private evidence omission and historical snapshot confirmation. Existing token/consent controls retain meaningful secret and lifetime assertions. SSR does not qualify hydration, browser dispatch/effect ordering, focus handoff or assistive-technology announcement timing.

## Qualification checkpoint

Independent source review approved all four production/test files. The local focused frontend test/type/lint command was submitted through the existing shared verification owner:

```sh
agent-heavy-check -- python3 /tmp/pointup-frontend-accessibility-focused-qualification-20261003.py
```

Handle 6065 ended with exit 75 before admission. No test/type/lint stage executed. The wrapper log is `/tmp/pointup-frontend-accessibility-focused-wrapper-20261003.log`; exact source hashes and the unadmitted receipt are in the owner checkpoint under `/home/jkail/.local/share/agent-hub/local-audits`. This is a queue blocker, not a passing qualification or an executed feature failure. No unchanged retry or alternate verifier was launched.

All build, test, CI-equivalent and release qualification remains local on GamingRig. Publication uses `[skip ci]` and does not represent skipped hosted checks as passes. Merge, production deployment and current-source native acceptance remain pending. Earlier full-suite/build/CodeQL receipts qualify their recorded preceding source, not this new UI candidate.

The fresh synthetic native fixture starts without accounts; web startup does not run demo seeding. First-account acceptance must avoid the explicit sample-data action/API. Before native acceptance, the runner must be guarded against this final candidate and a matching production build. Use one root-owned app server and one reused browser tab; preserve every unrelated fixture and agent session.
