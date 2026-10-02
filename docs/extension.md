# PointUp Chrome extension

The Manifest V3 extension reads a rewards balance from a page the user has
opened and signed in to. It retains a reviewable candidate locally; recording is
an explicit popup action. It does not sign in, handle MFA, read provider
passwords or send the page text to PointUp. The web-hosted assistant uses the
OpenAI Agents SDK when configured; extension chat calls that authorized server
runtime rather than storing a model API key in the browser.

## Capture and write-back

1. In PointUp, open Dashboard → Agents, grant time-boxed consent for the program
   and create a personal token with `observations:write`. Save the API URL and
   token in the extension popup.
2. Sign in to the program yourself and open its rewards balance page. The
   content script reads visible text on known provider pages, retries briefly
   after hydration and retains a detected candidate. Reading is automatic;
   submission is not.
3. Reopen the popup, check the program/points and select Record / retry balance.
   The personal-token path submits a frozen observation to the consent-gated
   agent endpoint. Current token, consent, host and account authority are checked
   server-side; unusual values are held for browser review.
4. If no clear reading appears, record manually in the account page. Page
   layouts vary; available extraction rules are not proof of live compatibility.

The popup has capture steps and a supported-program list. The seven existing
programs are United, Delta, American, Southwest, Marriott, Hyatt and Hilton.
The bank rules cover Chase Ultimate Rewards, US Amex Membership Rewards,
Capital One Miles and Bilt with program-specific labels and narrower bank hosts.
Bank page compatibility remains unverified until controlled live acceptance.

Extraction validates complete safe integers with strict comma grouping and
refuses decimal, negative, exponent, promotional or conflicting readings. Bank
rules distinguish the rewards product and unit from cash back, card balances
and status. Source references contain HTTPS origin/path, without query/hash;
credentials and nonstandard ports are rejected. International Amex pages must
not be silently assigned to the US program.

## Authorization and recovery

Personal tokens (`pu_…`, preferred) require `observations:write` and active
program consent. Capture identity, time and payload are frozen before posting
`/api/v1/agent/observations`. A timeout or unknown result retains the same review
for an exact retry that can recover the server receipt without duplicate effects.
The legacy Clerk-session token path records a manual snapshot on an already
linked account and lacks observation replay guarantees; check PointUp before
repeating an uncertain manual write. Full Clerk extension sign-in remains open.
Tokens are stored in `chrome.storage.local`; genuine ChatGPT plan credentials
are not implemented here and must not be treated as equivalent extension tokens.

Discard binds the displayed capture ID. Stale discards cannot delete a newer
candidate; discarding a local review does not undo a server submission. Persisted
feedback restores outcomes and observation/review references on reopening.
Capture errors show fixed guidance and validated support references. Raw provider
errors are not displayed.

Observation and proposal review buttons share one serialized extension-owned tab.
They reuse that tab without taking ownership of another agent's browser session.
Future agent verification should also reuse one owned tab per session.

Previously retained Southwest candidates with providerId `southwest` remain
frozen. Discard that local review explicitly and reload/recapture to use canonical
`southwest-rapid-rewards`; no payload rewriting or automatic replay occurs. New
captures resolve the actual core skill and canonical linked account.

## Assistant

Chat needs `portfolio:read`; proposing changes also needs `portfolio:write`.
Only typed questions and authorized PointUp data enter inference. Proposed
changes require review in the web dashboard. Pending questions and diagnostic
request IDs are stored before inference under the endpoint/token scope. A reopened
popup polls while the worker is active; worker restart reports uncertainty and
requires explicit retry after checking proposals. Correlation IDs do not authorize
or deduplicate writes. Changing credentials hides the former conversation scope.

The popup offers **Review proposed changes in PointUp** even when no proposal
card was returned. This covers a first request whose response was lost after a
proposal may have persisted. Opening review preserves the uncertain question and
support reference alongside navigation feedback. It uses the same extension-owned
review tab and neither resends the question nor approves a change.

Actual Chrome action-popup acceptance verified synthetic offline recovery,
reopening, disabled in-flight controls, Clear and native review-tab reuse.
See [the source, artifact identity and acceptance limits](chrome-extension-acceptance.md).
Live provider/API/model and worker-termination acceptance remain outstanding.

## Build and verification

```bash
npm run build --workspace @pointup/extension
# Chrome → chrome://extensions → Developer mode → Load unpacked
# Select apps/extension/dist
```

The build bundles background/content/popup code and copies the manifest/popup.
Root coordinates builds through the shared heavy-check wrapper after inspecting
running jobs. Focused tests verify pure extraction, manifest alignment, capture
replay/review and synthetic Chrome lifecycle behavior. The merged PR #34 source
passes all six [release verification jobs](https://github.com/jckail/point_bot/actions/runs/37033664518)
and [CodeQL](https://github.com/jckail/point_bot/actions/runs/37033664139), including
171 extension cases and the production bundle. Source checks establish bank
rule wiring, while live bank-page compatibility remains unverified. Native
assistant popup checks and their exact build are recorded in
[Chrome acceptance](chrome-extension-acceptance.md).

Add provider-specific rules and approved hosts in `src/extraction.ts`, matching
content-script patterns in `public/manifest.json`, and positive/negative fixtures.
Bank hosts require exact matching rather than implicit subdomain permission.
Use canonical server provider IDs and confirm every extraction host is authorized
by the corresponding core skill. A new rule or official public page is not evidence
of a logged-in balance/API connection.

Live provider extraction, authenticated browser/extension lifecycle, Clerk/PAT
and SDK/exporter delivery remain separate checks. See
[assistant-agent.md](assistant-agent.md), [integrations.md](integrations.md) and
[release-backlog.md](release-backlog.md) for remaining work.

Development HTTP endpoints are restricted to `localhost`, `127.0.0.1` and
`[::1]`; the manifest grants those exact hosts across ports. Changing hosts
changes the pending capture identity even when both addresses reach the same
local server. Restore the original settings to retry a frozen capture. A separate
native Chrome probe verified these exact grants and real local fetches; candidate
application installation and authenticated endpoint checks remain open. See
[acceptance evidence](chrome-extension-acceptance.md).
