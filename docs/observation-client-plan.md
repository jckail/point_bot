# Observation replay protocol for extension and MCP callers

Status: implemented in the integration source alongside managed observation
migration 0019. Final aggregate CI, live Chrome/provider execution and production
adoption remain pending. This replaces the earlier planning-only checkpoint;
[backend invariants](observation-integration-plan.md) and
[release gates](release-backlog.md) still apply.

The caller UUID `captureId` identifies one immutable capture submission; the
server-issued observation/review ID identifies its durable receipt. Do not swap
these IDs or use assistant proposal IDs for observation review. Optional
`captureId`/`sourceMethod` and result `observationId` are additive to existing strict
contracts and outcomes. Deploy the compatible schema/server before upgraded callers;
do not silently remove the key after an uncertain result or validation failure.

## Extension capture and frozen state

Capture is split across `extraction.ts`, `content.ts`, `capture-state.ts`, `config.ts`
and `background.ts`; submission is in `record.ts`. Pure extraction still supplies
provider/points and a query/hash-free source URL. A reviewed page candidate adds
one UUID, original ISO `observedAt` and `sourceMethod: 'page_capture'`.

Repeated hydration delivery of the same provider/source/points within one document
keeps the UUID/time. A changed reading or new document gets a new identity, even
when its points equal an earlier observation. Equal balances are not globally
deduplicated. Old stored captures without a trustworthy envelope require a fresh
page reading; their missing historical time is not invented during upgrade.

Before the first PAT POST, background storage freezes the exact request and a
SHA-256 identity of the configured API URL/token. The pending envelope survives
popup reopening and service-worker restart. New content candidates are stored
separately and cannot replace the displayed pending review or its retry payload.
Capture-state actions are serialized through the worker's queue. Capture requests
use a **25-second timeout**; a timeout retains the frozen request for recovery.

Retry sends the original key/time/method/skill/points/source/agent fields. A settings
or token change does not silently retry the pending request under another identity:
restore the original settings to retry, or inspect Dashboard → Agents before
explicitly discarding. The backend supports authorized same-owner credential
rotation, but this client deliberately requires recovery instead of assuming a
replacement token belongs to that owner.

Completion clears only state matching the capture UUID. A bounded persisted list
of the last **16 completed/discarded IDs** acts as tombstones, so queued hydration
messages cannot immediately resurrect a cleared capture. A newer candidate is not
removed by an older response. These tombstones are local delivery protection,
not permanent server replay storage. Explicit discard clears local review only;
it cannot undo a committed observation and instructs dashboard recovery first.

Source: [state protocol](../apps/extension/src/capture-state.ts),
[storage validation](../apps/extension/src/config.ts),
[content candidate](../apps/extension/src/content.ts),
[serialized worker and timeout](../apps/extension/src/background.ts).

## Outcomes and human review

| Result | Extension behavior |
| --- | --- |
| `recorded` / `unchanged` | Completed receipt; clear only matching pending capture, retain unrelated/newer candidates. |
| `needs_review` | Not saved; retain frozen request, review/receipt IDs and explicit held state. Open Dashboard → Agents for the user's decision. |
| `rejected` | Explain rejection and retain recovery context; do not report recording success or create a replacement UUID automatically. |
| Timeout/network uncertainty | Keep the exact frozen PAT request; retry recovers its canonical receipt. |
| `OBSERVATION_REPLAY_CONFLICT` 409 | Explain conflicting claims and require dashboard recovery or deliberate discard/new capture. Never replace the key automatically. |
| API settings changed | Refuse silent retry under another endpoint/token; preserve pending capture for recovery. |

The extension opens/reuses its own review tab and never invokes browser-only
confirm/reject endpoints. A replay before human resolution retains the same held
review ID; a replay afterward returns the current recorded/rejected receipt with
no actionable review ID. It cannot reverse or retrigger the user's decision.

The existing non-PAT Clerk/session-token path remains a manual balance write to an
already-linked account. It does **not** gain observation replay safety from this
capture envelope. After an uncertain manual write, inspect PointUp before retrying;
a caller UUID on a different endpoint does not establish idempotency.

Source: [record adapter](../apps/extension/src/record.ts),
[popup](../apps/extension/src/popup.ts),
[messages](../apps/extension/src/messages.ts).

## Stateless MCP protocol

`pointup_submit_balance` keeps its name, WRITE annotations, consent guidance,
HTTPS source claim, adapter-controlled agent label, optional membership auto-link
input and existing outcomes. Its input schema now accepts optional UUID `captureId`
and optional method (`page_capture`, `manual_entry`) alongside optional `observedAt`.
The stateless adapter forwards them unchanged rather than minting a new key per
invocation or caching captures across users.

The playbook instructs the caller to retain one UUID, original time and exact
capture claims before submitting; uncertain-result retries reuse those fields.
A genuinely new capture gets a new UUID. `manual_entry` is a self-reported method,
not authenticated evidence that the adapter visited a provider page. Legacy calls
without keys remain accepted with their existing admission semantics and lack
stable replay recovery.

`observations:write` and current provider consent still gate submission;
auto-link additionally requires current `portfolio:write` or session authority.
Each HTTP MCP request forwards its own PAT. Exact replay is authorized against
current token/grant state, while the original receipt preserves its witnesses.
The read-only audit tool remains available for recovery. No consent-grant or
confirmation/rejection tool is added. Replay conflicts remain tool errors with
the closed backend code rather than instructions to generate another key.

Source: [MCP tools/playbook](../apps/mcp/src/server.ts),
[per-request adapter](../apps/mcp/src/http.ts),
[wire schema](../packages/core/src/contracts/agent.ts),
[API client](../packages/api-client/src/index.ts).

## Verification and rollout boundaries

Focused caller/state/transport tests exercise stable hydration identity, frozen
payloads, restart-safe storage, settings binding, matching completion/tombstones,
held/rejected/conflict behavior and preserved manual-session behavior. MCP tests
exercise optional field validation/forwarding, adapter labels and existing tool
boundaries. These mocks do not prove Chrome lifecycle behavior or provider data.
The production-composed backend and migration checks are recorded in
[observation-integration-plan.md](observation-integration-plan.md).

Root's gated full workspace suite passed 834 tests, with one paid live evaluation
skipped; fresh aggregate CI after commit remains pending. Root owns aggregate
verification and release operations. Preserve the
compatible server-before-caller and migration-before-host activation gates. Live
Chrome tests should still cover popup reopening, service-worker lifetime, account
changes, timeout/retry, focus and reused review-tab behavior with Clerk and synthetic
portfolios; do not take over unrelated tabs. No provider passwords/page contents
are added to receipt storage. Tokens retain the existing configuration policy;
this stage does not claim a separate token-persistence or host-permissions redesign.
