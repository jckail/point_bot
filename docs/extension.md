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
3. The **popup** holds settings (API URL + session token) and shows the latest
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

The extension authenticates to the API with a **Clerk session token** as a
bearer header (the same path mobile uses — see [multi-surface.md](./multi-surface.md)).
Paste the token and your API URL into the popup's settings. A full
`@clerk/chrome-extension` sign-in flow is the natural follow-up; the client and
capture pipeline are already token-driven.

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
