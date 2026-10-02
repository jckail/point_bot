# Chrome extension assistant acceptance

On October 2, 2026, root verified the actual Chrome action popup and Manifest V3
service worker through the shared Chrome DevTools extension tools. The build used
source `68a53d6fc25b3e8d42e4496016461793b95fffa9`, merged in PR #34 at
`7e4a5b23cdb7d1cc6bb91c17f267f2b70fff136a`; both have tree
`f9f838cc4ff2d4f9bcc2795d3aa7f6896bbc1fc0`.

This is native popup/storage/tab evidence with synthetic network failures. It
establishes the behaviors below, not live provider or production acceptance.

## Setup and boundaries

The coordinated restart completion marker was verified before using shared
Chrome. No configuration or restart was performed by this session. Root ran
`agent-heavy-check -- npm run build --workspace @pointup/extension` after the
previous resource contention cleared. Installation used the registry-approved
Windows WSL path to the native build. Linux spelling and a separate Windows
artifact directory were refused by workspace policy; no policy was changed.

The installed extension was initially the only extension in this test profile.
Root used the real action popup (`contextType: POPUP`, `tabId: -1`), synthetic
settings for `https://pointup-acceptance.invalid`, and a service-worker fetch stub
that rejected requests without forwarding them. The synthetic token was never a
usable PointUp credential. The review destination intentionally had no server.
A normal tab loading `popup.html` was rejected by the existing privileged-message
sender guard; this guard was preserved, and acceptance used the actual popup.

## Observed behavior

| Check | Native result |
| --- | --- |
| Seeded uncertain state with no conversation cards | Actual popup restored question/support guidance and offered proposal review. |
| First explicit Ask with offline failure | One intercepted chat attempt; persisted `uncertain` state, retained question/support reference, empty conversation and usable review button. |
| Reopen after review navigation | Same saved question/support reference returned; no automatic chat attempt. |
| Repeated proposal review | Same extension-owned Chrome tab ID reused; no extra review tab or change to the pre-existing tab. |
| Deferred explicit Ask | Ask, Clear, review, settings and question controls disabled while work was in flight. |
| Close popup before deferred failure | Reopened popup displayed the durable uncertain outcome; controls recovered and private failure text was absent. |
| Clear and reopen | Chat/scope/pending recovery keys removed; reopened question/conversation/status empty. |

Exactly two explicit synthetic chat attempts occurred across the run. Reopen,
review and Clear added none. No proposal was approved, balance submitted, real
portfolio loaded, provider account visited or paid model called.

## Artifact identity and cleanup

| Built file | SHA-256 |
| --- | --- |
| `manifest.json` | `58683795b901b26250c0c65804f9041bd33d378b52f307b61d0f189ae0cf3cc4` |
| `popup.js` | `999f5641d7144fd095f0858b5ad2d024569e3e9195b3d06d8565c1a3700120dc` |
| `background.js` | `48988ad5dfda303a03105799c2dba73cc7670f46d7019d62b3a072278adcd672` |

Temporary synthetic storage was cleared. Root closed its popup/review pages and
uninstalled only its own extension. Final tool inspection showed no extensions
and only the original `about:blank` page, which was left untouched. One owned
review tab was reused; temporary popup contexts were closed as the run advanced.

## Remaining acceptance

Live provider DOM/capture, authenticated API and Clerk owner changes, actual MV3
worker termination, paid inference and cloud trace/exporter delivery remain open.
The synthetic fetch stub does not prove CORS, TLS, host permissions, actual API
errors or a production endpoint. In particular, origin validation accepts HTTP
IPv4/IPv6 loopback. The follow-up manifest fix adds exact `http://127.0.0.1/*`
and `http://[::1]/*` grants alongside `http://localhost/*`, with 35 focused
alignment/retry tests passing. Its local wrapped rebuild hit the shared verification
queue timeout (exit 75); PR #35 CI subsequently built the candidate successfully.
The earlier native popup run above used the PR #34 manifest. The isolated native
permission probe below establishes the new patterns independently of that popup.
See
[release backlog](release-backlog.md) and [extension guide](extension.md).

## Native loopback permission probe

Root installed a separate minimal Manifest V3 probe using the exact host
permissions from PR #35 source `c0f6bdd259c0625f236c05855e44c61d6d1c2acb`
(merged at `95b610e21851bf2356c30277d521fd95f314db1e`). Chrome accepted both
new patterns. Its actual service worker, without a fetch stub, received HTTP 200
and the expected fixed JSON fixture through each of `localhost`, `127.0.0.1`
and `[::1]` on port 55797. The owned Windows Python fixture bound only IPv4/IPv6
loopback and sent no CORS headers. There were exactly three GET requests and no
credentials, PointUp API calls, provider visits or model calls.

This proves Chrome pattern acceptance and real cross-origin local fetch permission
for the isolated probe. It does not establish actual PointUp route authentication,
server error handling, TLS, provider capture or a native installation of the new
application build. Root uninstalled only the probe and stopped its identity-checked
fixture process. Final browser inspection again showed no installed extensions
and only the untouched original `about:blank` page; the probe opened no tab.

## Native settings-save draft isolation

Root built the current extension through the foreground shared verification gate
and installed the actual unpacked application in isolated Chrome. The build used
master `f88ac067d8c69a5f85d7fd008666f5c1b2a839a2` plus the successful-settings-save
draft reset. Its popup source SHA-256 is
`148b854d0ff222db8250621d61915846f72fb66b3d9e4d486aabce6e0438db36`.

| Artifact | SHA-256 |
| --- | --- |
| Manifest, including PR #35 loopback grants | `73a0be6cb5ba948d24d381349b550c879dae340fa00f1c2d4ca9909470c5cabc` |
| Popup bundle | `fae3e1ee7985aedbb59ed02dbe7d23f3999ef02d701bc91ca249a288a4578be0` |
| Background bundle | `48988ad5dfda303a03105799c2dba73cc7670f46d7019d62b3a072278adcd672` |

One owned privileged popup was reused for three cases with synthetic unusable
credentials. Real Chrome storage persisted a changed token while preserving its
origin, then a changed canonical endpoint while preserving its token. Each
successful Save cleared the unsent old-scope draft. An invalid HTTP non-loopback
URL preserved the draft and both stored credentials. Controls recovered after
each case. The service worker recorded zero outgoing requests; its fetch adapter
blocked every attempted request. No Ask, API/model request, provider visit or
portfolio/capture mutation was performed.

This establishes current application installation, popup behavior and real
settings persistence for those cases. Busy-worker responses and storage-write
failures remain covered by focused fake-DOM tests, not this native run. Live
identity rotation, authenticated endpoints, MV3 termination, inference, provider
capture and exporter delivery remain open. Root cleared only the test extension's
storage, closed its popup, uninstalled it and stopped the owned loopback
verification server. The wrapped check exited successfully; the original
`about:blank` page was untouched.
