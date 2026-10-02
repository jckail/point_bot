# PointUp Chrome extension

The Manifest V3 extension guides a person through loyalty balance collection.
Provider sign-in, passwords, passkeys, MFA and captchas stay on the provider site.
Every page read, manual review, navigation and submission requires a user action.
There is no unattended sign-in, provider polling or private provider API replay.

## Guided collection

1. Choose a program. The chooser covers all 13 IDs in the core catalog, using
   verified official entry links from [provider-capabilities.md](./provider-capabilities.md).
2. Click **Open provider sign-in**. The extension creates one dedicated guide tab
   and reuses that tab for later provider or PointUp navigation; it does not search
   for or repurpose unrelated existing tabs. Complete sign-in and MFA yourself.
3. Reopen the popup on the account dashboard. For United, Delta, American,
   Marriott, Hilton and Hyatt, **Capture this tab** offers the existing heuristic
   visible-text reader. No additional reader is claimed from public-page research.
   Other programs use **Review manual balance** after you enter the displayed
   redeemable points/miles and confirm the unit. Reader programs also have this
   manual fallback.
4. Review the currency, amount, source origin, time and source method. Select the
   linked PointUp account explicitly; only its membership suffix is shown.
5. Click **Confirm and record** to submit a consent-bound observation, or
   **Discard** to clear the review. Use **Open PointUp settings and approvals** to
   sign in, manage account/provider collection consent, tokens and held observations.

Bilt starts at `https://www.bilt.com/`, with both Bilt and biltrewards.com official
hosts recognized. Bilt Cash USD is not Bilt Points. Amtrak uses Available Points,
not Tier Qualifying Points. Credit-card programs require the correct card/account
and redeemable unit rather than pending points or cash equivalents.

Rakuten has a guided official link but numeric collection is disabled: its USD,
Amex and Bilt payout choices cannot safely map to the catalog's generic Rakuten
points. Choose the actual payout program in PointUp; the extension never converts
cash into integer points. Southwest remains a legacy extraction fixture but is
not offered in the chooser because it is absent from the current core catalog.

## Consent, observations and retries

Collection uses `POST /api/v1/agents/observations`, never the raw manual balance
endpoint. It requires a PointUp personal access token (PAT) with `portfolio:read`
and `observations:write`, plus active account/provider consent granted in a signed-in
PointUp browser session. A temporary Clerk session token cannot substitute for
agent collection authorization. Revoked, expired or missing consent is rejected by
the server. Consent and source checks are enforced there, independently of popup UI.

Manual entries are marked `manual_entry` and reference the verified program entry
URL; this does not claim a page was read or ownership was proven from its URL.
Page observations are marked `page_capture` and send only the source origin.
The server records the source host and can hold anomalous changes for human review
without immediately updating the balance. The popup distinguishes accepted, held
and rejected results; approve or reject held changes in signed-in PointUp settings.

Each review has a UUID. Before submitting, the extension freezes that UUID,
account, amount, time, source and method in trusted session storage. A lost response
is retried with the exact same payload and ID, so the server can return the existing
result without creating another snapshot. The retry review shows its locked account
and amount; changed payloads are refused. Successful or held submissions clear it.
Reviews expire after ten minutes. Check PointUp before discarding an uncertain
submission, changing tokens or creating another review, which creates a new ID.

## Permissions and data

The manifest grants `storage`, `activeTab` and `scripting`; no provider scripts run
on installation or navigation, and no provider host access is granted persistently.
A page read occurs once in the active tab's top frame after an explicit capture
click. It reads bounded visible text, not password fields, cookies or credential
values. Raw text never leaves the extension and is not retained or sent to chat.
Exact audited HTTPS hosts identify programs; unverified subdomains are refused.
Extraction rejects malformed, fractional, negative and conflicting values but
remains a heuristic: verify the result against the signed-in provider account.

Save the PointUp API origin and token. Saving requests Chrome access only to the
chosen API origin. HTTPS is required except loopback HTTP for development. URL
paths, queries and embedded credentials are rejected, and API fetches reject
redirects. Runtime actions accept messages only from the exact extension popup;
provider tabs cannot submit captures, observations or approvals.

PATs start with `pu_` and are minted once in signed-in PointUp settings; the extension
does not auto-mint them. Default token storage is `chrome.storage.session`. An
explicit **Remember this PointUp PAT on this device** checkbox permits local storage
for that PAT only; local access is restricted to trusted extension contexts.
Clerk session credentials cannot be remembered. **Forget token** removes the device
copy; revoke the PAT in PointUp settings to disable it everywhere. Earlier versions'
unconditionally persisted tokens and captures are removed on load. Saving settings
clears conversation and reviews to avoid carrying them across account changes.

## Assistant and action review

The assistant uses the authenticated shared `/api/v1/assistant/chat` API. PAT chat
requires `assistant:chat` (and `actions:propose` for supported proposed changes).
It sends only your typed question and up to sixteen conversation messages, each
capped at 4,000 characters. Captured balances, provider page text, browser URLs and
API tokens are not added to the conversation. The server can use your PointUp
portfolio to answer. Responses render as plain text; request ID, runtime mode and
trace ID appear where supplied for correlation.

Chat requests identify the extension surface for server logs. Failed responses
show a validated support reference when supplied, without exposing upstream error
bodies. The server caps extension runs at 20 seconds to leave room before Chrome's
service-worker fetch response limit; increasing the client timeout does not remove
that browser limit. Web requests can use the longer configured runtime deadline.
See [Chrome's service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Proposed changes appear with a title, summary, status, expiry and **Review in
PointUp** button. That button opens browser settings; it does not call an approval
endpoint. Approval/rejection requires a signed-in browser session. PATs cannot
approve actions. Proposal status shown in a saved conversation is a snapshot;
PointUp is the current review authority. Conversation lasts only in session
storage. **Clear conversation** deletes it, and failed questions remain available
for retry. Verify advice and provider terms before acting.

## Build, load and checks

```bash
npm run build --workspace @pointup/extension
npm run test --workspace @pointup/extension
npm run typecheck --workspace @pointup/extension
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `apps/extension/dist`. Reload after rebuilding. Tests cover permissions,
verified guide/catalog links, exact origins, unit rejection, token persistence
consent, sender boundaries, extraction, UUID retries, denied consent, held results,
owned-tab reuse and assistant/proposal isolation. Real Chrome prompts, authenticated
provider dashboards and real PointUp sessions/PATs still require a browser smoke test.
