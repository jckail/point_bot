# PointUp Chrome extension

`apps/extension` is a Manifest V3 Chrome extension that captures loyalty
balances from provider pages **you're already signed in to** and records them
in PointUp as manual snapshots — sync without ever sharing your program
credentials with PointUp.

It's the second consumer of `@pointup/api-client` (after the web app), which is
exactly what the multi-surface architecture was built for — see
[multi-surface.md](./multi-surface.md).

## How it works

```
provider page ──content script──▶ background worker ──@pointup/api-client──▶ PointUp API
  (reads the visible          (matches provider → account,
   balance, no creds)          records a manual balance)
```

1. A **content script** runs only on known provider domains (United, Delta,
   American, Southwest, Marriott, Hyatt, Hilton). It reads the page's visible
   text and extracts the balance.
2. The **background service worker** stores the latest capture and, when you
   click **Record balance** in the popup, looks up your matching linked account
   and posts a manual balance via the API.
3. The **popup** holds settings (API URL + access token) and shows the latest
   capture.

The extraction logic (`src/extraction.ts`) is **pure and unit-tested** — no DOM,
no `chrome` APIs — so provider patterns can be validated exhaustively. A test
also asserts the manifest's `content_scripts` matches stay in sync with the
provider rules, so adding a provider can't silently miss the manifest.

## What it never does

- It never reads passwords, cookies, or credential fields — only the balance
  number the page already displays to the signed-in user.
- It has no provider automation; capture is a one-click, user-initiated action.

## Auth

Two token types are accepted in the popup, chosen by prefix:

- **Personal access token (`pu_...`, preferred).** Create one at *Dashboard →
  Agents* with the `observations:write` scope. Records go through
  `POST /api/v1/agent/observations`: the program must have an **active
  consent**, the source page must be on the skill's allowed hosts (the
  extension sends origin + path only, never the query string), implausible
  readings are held as `needs_review` (confirm or reject them in *Dashboard → Agents*), and every write is audited. If consent is
  missing the popup says so and points at *Dashboard → Agents*.
- **Clerk session token (legacy).** Records a manual snapshot on an
  already-linked account (same path mobile uses — see
  [multi-surface.md](./multi-surface.md)).

Tokens live in `chrome.storage.local`. A full `@clerk/chrome-extension`
sign-in flow is still a follow-up. The branching logic is in `src/record.ts`
and unit-tested with a fake fetch.

## Build & load

```bash
npm run build --workspace @pointup/extension
# Then in Chrome: chrome://extensions → Developer mode → Load unpacked →
# select apps/extension/dist
```

`npm run build` bundles `background`, `content`, and `popup` with esbuild and
copies `manifest.json` + `popup.html` into `dist/`.

## Adding a provider

Add a rule to `PROVIDER_PAGE_RULES` in `src/extraction.ts` (host + balance
regex) **and** the matching `https://*.<host>/*` entry to
`public/manifest.json` `content_scripts[0].matches`. The sync test will fail if
you forget the manifest.

## Capture and review recovery

Discard is bound to the capture ID displayed by the popup. If a newer candidate
arrives or a queued recording completes, a stale discard fails without deleting
or tombstoning the unseen capture. Discarding a local review still does not undo
a server submission; inspect PointUp before recording a fresh observation.

Assistant proposal and observation review buttons share one serialized helper
and one extension-owned review tab. Concurrent requests reuse that tab; closed
or failed tabs can recover on a later request. They never take ownership of
other agent sessions' tabs.

Reopening the popup restores persisted outcome, explanation and observation/
review references as plain text. Record/settings controls indicate pending work,
worker failures end the pending state, and a saved configuration is distinguished
from a conversation-clear failure. A popup reopened during assistant inference
still needs durable pending-chat recovery; full Clerk extension sign-in and
capture API support-reference expansion remain follow-ups.

Focused concurrency/stale-discard/popup cases pass with synthetic Chrome APIs.
Exact runtime3e7ba69 passes all six CI36992427488 jobs and CodeQL36992427509,
including52 extension tests and the extension production bundle.
No live browser lifecycle, provider extraction, Clerk/PAT or SDK/exporter test is
claimed. Future live verification should reuse one owned tab per agent session.
