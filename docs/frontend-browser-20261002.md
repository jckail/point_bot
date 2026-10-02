# Actual local frontend audit — 2026-10-02

A bounded real application audit ran against PR #49 master
`afdb606de5a37f9d754fbf9793aa7c7daa8f1ebb`, tree
`560ae25ccd6329ce4e4f31439ce20efaac0362b2`. Candidate source
`76d6da61ff3323f272febf64367cab3184b1573b`, prospective merge and actual master
share that tree. [Candidate CI 37066196070](https://github.com/jckail/point_bot/actions/runs/37066196070),
[CodeQL 37066196114](https://github.com/jckail/point_bot/actions/runs/37066196114),
Bugbot, [master Deploy 37066765821](https://github.com/jckail/point_bot/actions/runs/37066765821)
and [master CodeQL 37066765528](https://github.com/jckail/point_bot/actions/runs/37066765528)
passed with 1,847 workspace tests and one paid live skip. AWS deployment was
skipped for missing role configuration.

This receipt supersedes the unexecuted browser plan in
[frontend-audit-20261002.md](frontend-audit-20261002.md). It is partial feature
coverage, not an all-features acceptance or production/auth/provider/model receipt.

## Execution and ownership

Root alone ran one foreground `agent-heavy-check` after a fresh empty/free queue
and same-repository job inspection. The job scanner initially counted 48 idle
external MCP services as application jobs; it was corrected without touching them.
Earlier exit 75 and stopped-before-start exit 130 attempts remain historical
failures, not execution evidence.

The app used supported dev authentication on `127.0.0.1:3117`, the new isolated
`pointup_frontend_root_20261002` PostgreSQL database in root's owned container,
and no optional identity/provider/model credentials. Dashboard sample loading
and all later mutations affected only this synthetic owner/database. Browser
control used one owned isolated Toolport Chrome page, 15, reused for every route;
original page 1 remained untouched. The 390px mobile viewport was verified through
actual device emulation (window resize alone hit Chrome's minimum width).
Screenshots were visually inspected at the initial landing viewport and 1440px
desktop dashboard.

The local launcher session 26550 was stopped before the 20-minute limit. Its
wrapper exited **130 on intentional owner shutdown**, not a green test-suite exit.
Both owned launcher/wrapper processes were signalled; its owned server group
closed and port 3117 stopped accepting connections. The owned database container
was stopped and synthetic data retained. Only verified Next-generated type bytes
were restored and the two newly generated instruction files were archived/removed;
no application source, cache, dependency or another agent's process was reset.
Log: `/tmp/pointup-local-frontend-root-20261002-current.log`.
Curated receipt: `/tmp/pointup-native-frontend-evidence-20261002.json`.

## Observed feature behavior

| Surface | Executed in the real local app | Remaining qualification |
| --- | --- | --- |
| Landing/navigation | Illustrated sample labeled; navigation and skip-link destination present; screenshot inspected | Full keyboard/focus audit and 390px landing acceptance |
| Empty/demo | Empty guidance; sample button created five programs and Kyoto goal | Repeat sample error path |
| Programs/filters | United search narrowed to one; Hotel plus United produced zero; Reset restored six after import | All tag combinations, pin mutation, duplicate link errors |
| Account detail | Associated membership/balance/UTC labels; past UTC reading 55,000 remained behind newer 54,200; history retained both; membership, multiline notes and tags confirmed by actual API reads | All validation and session/owner transition UI states |
| Custom valuation | Enter saved 1.2346 as 1.235 with matching estimate; same-normalized save restored input; observer saw both pending buttons disable/re-enable; blank Reset and already-catalog invalid 101 draft Reset restored 1.2; tiny Save showed bounded error with no stored override | Full screen-reader/keyboard matrix and concurrent-tab writes |
| Transfer card | Chase selection saved Sapphire Preferred and actual API read returned its product ID | Clear selection and all card/provider constraints in native UI |
| Sync | Demo/unavailable caveats and pending-aware controls visible | Demo action and actual provider sync execution |
| Unlink/Restore | All six programs unlinked via detail UI; United and Chase restored; balance, membership and notes retained | Expired undo and real owner/session transitions |
| Goals | Selected United goal created at 54,200/80,000 with named 67.8% progress; Remove deleted it and preserved Kyoto | All input errors and expired/session scenarios |
| CSV/JSON | Malformed CSV showed error without changing account count; quoted multiline Delta membership imported and re-exported with quoting; endpoints returned 200/content types/attachment metadata | Full snapshot round trip and all malformed-row cases; notes are outside CSV format |
| Share | Actual share page hid memberships/notes; Revoke remained after last unlink; revocation made public fetch return 404 | Expired links and production anonymous/auth separation |
| Opportunities/expiry | Estimate caveats; explicitly seeded local expiry produced warning and calendar link; calendar returned 200 with valid VCALENDAR/United | Live award/provider integration and complete optimizer interactions |
| Agent access | UI created read-only one-day PAT; full token read returned 200 and write returned 403 INSUFFICIENT_SCOPE; revoke removed active row/secret; consent granted then revoked | Held observation/review and cross-owner native scenarios |
| Assistant | Actual panel Enter/send returned fallback chat 200; successful correlated run-start/run-complete events; clearing persisted across navigation/reopen | Live Agents SDK model calls, recovery faults, generated proposal approval/reject/expiry and exporter delivery |
| Settings | Actual unconfigured ChatGPT-linking state and capability boundaries rendered | Real Clerk/OpenAI identity acceptance |
| Responsive | No page overflow at verified 390px dashboard/detail/share/agents/settings; desktop 1440px dashboard had three-column grid and no overflow | Full axe/contrast/focus/screen-reader and other narrow routes |

Some form buttons were invoked through their actual DOM controls. A pointer click
intended for consent initially navigated to Settings without granting consent;
execution continued only after checking the current page/control and invoking the
intended form button. This is a tooling observation, not a proved product defect.
An immediate clear-chat DOM read occurred before React committed; navigation and
reopening the panel subsequently verified that messages were cleared.
No synthetic server-action replacement, mocked API or paid/model/provider call
was used for this actual-app pass.

## Confirmed error-path defect and source fix

The initial token extraction selected the displayed seven-character prefix instead
of the one-time 46-character token. Correcting that fixture produced read 200 and
write 403 as expected. The **invalid prefix still genuinely returned 500 INTERNAL**
for read/write requests rather than the expected authentication 401.

`mapError` relied on `instanceof DomainError`, while composed use cases are cached
on globalThis and route/module generations can have different constructors.
Telemetry rethrows the original object; its separate sanitized log representation
did not cause the mapping failure. Exact live constructor identity was not
instrumented, so the bundle/cache explanation remains an inference supported by
source and a reproducing regression.

The reviewed fix registers genuine domain-error objects in a process-local shared
WeakSet and uses that identity for HTTP mapping. Closed known-code validation,
transport-code exclusion and private INTERNAL fallback remain. Raw JSON, native
errors with copied codes, copied prototypes and malformed/getter properties cannot
supply public domain messages. This is same-process module-generation recognition,
not reconstruction of serialized or cross-process errors.

Two original-source tests retained an actual traced authenticator/error across
module reevaluation and failed on INTERNAL versus expected 401/403. They assert
constructor mismatch before mapping and do not fail merely on a missing new export.
All four final regression cases plus access-policy/auth controls pass: **52 tests**.
Command: `npm exec --workspace=@pointup/web -- vitest run src/server/domain-error-identity.test.ts src/server/access-policy.test.ts src/server/auth.test.ts --maxWorkers=2`.
Core/web types and three-file lint pass after an explicit unknown runtime-code
annotation resolved the initial TS2367 error. That failed typecheck log is retained.
No OTel test file ran; the earlier command included an absent path, and final
verification uses only the three actual files above.

Logs: `/tmp/pointup-domain-error-identity-{red,final-green,types,types-fixed,lint,final-lint}.log`.
A fresh server start is required because pre-fix cached classes were never registered.
A second fresh empty/free admission started the real app once, reusing only the
retained verified owned synthetic database. Browser page 16 was the sole owned tab
and was closed afterwards. Invalid-token reads and writes now return **401
UNAUTHENTICATED**, session reads remain 200 with two retained accounts, a newly
created read-only token reads 200 and writes 403 INSUFFICIENT_SCOPE, and revocation
makes that token read return 401. The token's one-time creation form retains its
plaintext after same-page revocation, although authorization is denied; navigation
clears the display. Hiding that stale creation result remains UI polish to consider.

The actual retest source fingerprints are core errors SHA256
`1bfc5719a33d01dafbf0aee9ed8e415469fd837f79e237bab1f8987df307aa70`,
access policy `7785d3d7d192fa6749e962b38ba9b31c4b6694392f8ee06512fb0a11b770d5ea`
and regression `84a0b3f0676c3cf1a1aec38e04d49bd692faefda2b61e0e3888014a565445057`.
Log: `/tmp/pointup-local-frontend-root-20261002-retest.log`; launcher session 98698.
Root signalled only the exact helper, leaving the wrapper to report its result.
That temporary helper's signal handler reentered its blocking subprocess wait;
the server group closed, but helper 3094095 remained in a futex wait and was
force-stopped after exact ownership verification. The wrapper reported **247**,
so this is functional browser assertion evidence with failed shutdown, not a
green wrapper run. The temporary launchers now signal in the handler and poll/wait
outside it; syntax validation passed, without another app run merely for cleanup.
Server port 3117 is closed, owned PG stopped and fixture data retained.
**This iteration's release gates are pending.** The retest never created/dropped
fixtures blindly or bypassed the shared admission gate.

Production, identity, model, native extension, data and licensing gates remain
in [release-backlog.md](release-backlog.md). Shared Graphify still excludes PointUp
and its semantic index remains held; this work verified live source.
