# PointUp API v1 reference

Every surface — web app, mobile, browser extension — talks to the same versioned HTTP API. Wire shapes are defined once with zod in [`@pointup/core/contracts`](../packages/core/src/contracts/index.ts) and consumed through the typed [`@pointup/api-client`](../packages/api-client) package, so this document and the code cannot drift far apart: the contracts module is the source of truth.

## Conventions

- **Base path**: `/api/v1` (plus the unversioned `/api/health` for load balancer checks).
- **Auth**: all endpoints except `GET /api/health` and `GET /api/v1/providers` require a Clerk session. In the browser, the session cookie is sent automatically; native surfaces attach a Clerk token via `Authorization: Bearer <token>` (see [multi-surface.md](./multi-surface.md)).
- **Content type**: `application/json` both ways.
- **Strict requests**: request bodies are validated with `.strict()` zod schemas — unknown keys are rejected with `INVALID_REQUEST` rather than silently ignored.
- **Strict timestamps**: every date on the wire is a strict ISO-8601 UTC string with a `Z` suffix (e.g. `2026-07-08T14:03:00.000Z`). Date-only values and non-UTC offsets are rejected on input; `Date` objects never cross the network.
- **Errors**: a uniform envelope with a stable, machine-readable code from the domain layer:

```json
{ "error": { "code": "DUPLICATE_LOYALTY_ACCOUNT", "message": "united is already linked." } }
```

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No valid session |
| `INVALID_REQUEST` | 400 | Request body/query failed schema validation |
| `REQUEST_TOO_LARGE` | 413 | JSON request body exceeds the bounded 2 MiB limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | JSON request requires `Content-Type: application/json` |
| `INVALID_ID` | 422 | An identifier (user, account, goal, ...) was empty or not a string |
| `PROVIDER_NOT_SUPPORTED` | 422 | Provider id is not in the catalog |
| `INVALID_MEMBERSHIP_NUMBER` | 422 | Membership number is blank |
| `INVALID_CARD_PRODUCT` | 400 | Choose a supported transfer card compatible with the account program. |
| `INVALID_VALUATION` | 422 | Custom cents-per-point is ≤ 0 or > 100 |
| `INVALID_AWARD_WATCH` | 422 | Watch label/threshold failed validation |
| `INVALID_TRANSFER_BONUS` | 422 | Bonus failed validation (unknown program, no transfer path, multiplier outside (1.0, 3.0], ends before it starts) |
| `INVALID_REDEMPTION_GOAL` | 422 | Optimizer goal failed validation (unknown target program, bad quantity or min value) |
| `INVALID_DISPLAY_CURRENCY` | 422 | Display currency not in the supported set |
| `AWARD_WATCH_NOT_FOUND` | 404 | Watch does not exist **or is not yours** |
| `INVALID_BALANCE` | 422 | Points value is negative or fractional |
| `INVALID_CAPTURE_TIME` | 422 | Capture timestamp is malformed or in the future |
| `INVALID_GOAL_TITLE` | 422 | Goal title/notes failed validation |
| `INVALID_GOAL_TARGET` | 422 | Target points is not a positive integer |
| `INVALID_IMPORT` | 422 | CSV import payload is missing columns or empty |
| `INVALID_ACCOUNT_NOTES` | 422 | Notes exceed 2000 characters |
| `INVALID_ACCOUNT_TAG` | 422 | Tag failed normalization |
| `DEMO_PORTFOLIO_NOT_EMPTY` | 409 | Demo seed refused because accounts already exist |
| `ACCOUNT_NOT_RESTORABLE` | 409 | Soft-deleted account outside the restore window |
| `DUPLICATE_LOYALTY_ACCOUNT` | 409 | Provider already linked for this user |
| `LOYALTY_ACCOUNT_NOT_FOUND` | 404 | Account does not exist **or is not yours** (never distinguishable) |
| `TRIP_GOAL_NOT_FOUND` | 404 | Goal does not exist **or is not yours** |
| `SHARE_LINK_NOT_FOUND` | 404 | Share token missing, revoked, or expired |
| `INVALID_SHARE_EXPIRY` | 400 | Share expiry must be a whole number of days from 1 to 365, or omitted/null |
| `INVALID_ASSISTANT_MESSAGE` | 422 | Chat message empty or too long |
| `INVALID_SCRAPE_URL` | 422 | Scrape URL is not absolute http(s) |
| `ASSISTANT_UNAVAILABLE` | 503 | LLM provider failed |
| `ASSISTANT_ACTION_NOT_FOUND` | 404 | Proposal does not exist **or is not yours** |
| `INVALID_ASSISTANT_ACTION` | 400 | Proposal values or execution preconditions are invalid |
| `SCRAPE_FAILED` | 502 | Page scraper failed |
| `CREDENTIAL_UNAVAILABLE` | 409 | Sync needed credentials but none were resolvable |
| `INSUFFICIENT_SCOPE` | 403 | Access token lacks the scope the route needs (or the route is session-only) |
| `CSRF_REJECTED` | 403 | Cookie-authenticated state-changing request failed the origin/content-type checks |
| `INVALID_ACCESS_TOKEN_REQUEST` | 422 | Token name, scopes or lifetime failed validation |
| `ACCESS_TOKEN_NOT_FOUND` | 404 | Token does not exist **or is not yours** |
| `CONSENT_REQUIRED` | 403 | Agent write-back refused: no active consent for that provider |
| `CONSENT_NOT_FOUND` | 404 | Consent does not exist **or is not yours** |
| `INVALID_CONSENT` | 422 | Consent lifetime outside 1-90 days |
| `SKILL_NOT_FOUND` | 404 | No agent skill for that id |
| `INVALID_OBSERVATION` | 422 | Agent observation rejected (bad value, non-https or off-allow-list source) |
| `OBSERVATION_REPLAY_CONFLICT` | 409 | Capture UUID already belongs to a different canonical payload; recover its receipt before making a new capture |
| `REVIEW_NOT_FOUND` | 404 | Held reading does not exist **or is not yours** |
| `REVIEW_ALREADY_RESOLVED` | 409 | Held reading was already confirmed or rejected |
| `REVIEW_EXPIRED` | 410 | Held reading passed its 24 hour review window |
| `REVIEW_STALE` | 409 | The account's latest balance changed since the reading was held |
| `RATE_LIMITED` | 429 | Per-principal rate limit exceeded (see `Retry-After`) |
| `INTERNAL` | 500 | Unexpected server error |

## Endpoints

### `GET /api/health`

Unauthenticated liveness check used by the ALB. Returns `{ "status": "ok" }`.

### `GET /api/v1/openapi.json`

Public OpenAPI 3.1 document for this API, generated from the same zod contracts the server validates against (component schemas via `z.toJSONSchema`). Point Swagger UI or a client generator at it, or fetch via `client.getOpenApiDocument()`.

### `GET /api/v1/providers`

The catalog of supported loyalty programs. Public — surfaces use it to render link forms before sign-in. `kind` is one of `airline`, `hotel`, `credit_card`, `rail`, or `shopping`, covering airlines, hotels, transferable credit card currencies (Chase Ultimate Rewards, Amex Membership Rewards, Capital One, Citi ThankYou, Bilt), rail (Amtrak Guest Rewards), and shopping portals (Rakuten).

```json
[
  { "id": "united", "kind": "airline", "displayName": "United Airlines", "pointsCurrency": "MileagePlus miles", "estimatedCentsPerPoint": 1.2 },
  { "id": "chase-ultimate-rewards", "kind": "credit_card", "displayName": "Chase Ultimate Rewards", "pointsCurrency": "Ultimate Rewards points", "estimatedCentsPerPoint": 1.6 }
]
```

`estimatedCentsPerPoint` is an editorial estimate of one point's redemption value, used to compute the `estimatedValueCents` fields below. It is not a market price.

### `GET /api/v1/summary`

Aggregated portfolio view for the signed-in user.

When the user's display currency (see `/api/v1/settings`) is not USD, the response also carries a best-effort converted total — omitted/null if FX is unavailable:

```json
{ "display": { "currency": "EUR", "amount": 1877.2, "ratePerUsd": 0.92 } }
```

```json
{
  "totalPoints": 154120,
  "totalValueCents": 204044,
  "accountCount": 5,
  "byKind": {
    "airline": { "accounts": 2, "points": 48320, "valueCents": 57984 },
    "hotel": { "accounts": 2, "points": 25800, "valueCents": 18060 },
    "credit_card": { "accounts": 1, "points": 80000, "valueCents": 128000 },
    "rail": { "accounts": 0, "points": 0, "valueCents": 0 },
    "shopping": { "accounts": 0, "points": 0, "valueCents": 0 }
  },
  "lastSyncedAt": "2026-07-08T14:03:00.000Z"
}
```

Monetary fields are whole US cents at each provider's `estimatedCentsPerPoint`.

`byKind` always contains every provider kind, with zeroed entries for kinds the user has no accounts in.

### `GET /api/v1/settings` / `PUT /api/v1/settings`

Per-user display settings. Currently one preference: `displayCurrency` (`USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`; defaults to USD). Valuations stay USD-denominated internally — conversion happens only at the display edge using an FX source (`FX_API_URL`, frankfurter-style; pinned static rates in dev).

```json
{ "displayCurrency": "EUR" }
```

### `GET /api/v1/export`

Portable dump of the signed-in user's accounts and balance history. Query: `?format=json` (default) or `?format=csv`.

JSON response:

```json
{
  "exportedAt": "2026-07-08T14:03:00.000Z",
  "accounts": [
    {
      "account": { "id": "9f8d1c2e-...", "provider": { "...": "..." }, "trend": { "...": "..." } },
      "history": [
        { "points": 48320, "source": "sync", "capturedAt": "2026-07-08T14:03:00.000Z" }
      ]
    }
  ]
}
```

CSV responses set `Content-Disposition: attachment` and flatten one row per snapshot (plus a row for accounts with no history).

### `POST /api/v1/import`

Rehydrate accounts and balances from a PointUp CSV export (the same shape as `GET /api/v1/export?format=csv`). Existing provider links are reused; missing programs are linked; rows with `points` + `capturedAt` become manual snapshots.

Quoted fields may contain commas, doubled quotes and LF, CRLF or CR line breaks.
Import treats those line breaks as field content rather than separate accounts
or balance rows. Malformed quoting is rejected before any account or balance
mutation. Export also quotes carriage returns so its output remains portable.

```json
{ "csv": "accountId,providerId,...\n..." }
```

Returns `201`:

```json
{ "accountsLinked": 2, "balancesRecorded": 5, "skippedRows": 1 }
```

### `GET /api/v1/calendar.ics`

iCalendar (RFC 5545) feed of account expiration dates. Subscribe from Apple Calendar, Google Calendar, or Outlook. `Content-Type: text/calendar`.

### `GET /api/v1/goals`

Trip goals for the signed-in user, with progress against linked account balances.

```json
[
  {
    "id": "...",
    "title": "Kyoto Hyatt stay",
    "targetPoints": 80000,
    "targetDate": "2026-12-01",
    "accountIds": ["9f8d1c2e-..."],
    "status": "active",
    "notes": null,
    "currentPoints": 52000,
    "remainingPoints": 28000,
    "percentComplete": 65,
    "achieved": false,
    "createdAt": "2026-07-01T09:00:00.000Z",
    "updatedAt": "2026-07-01T09:00:00.000Z"
  }
]
```

### `POST /api/v1/goals`

Create a goal. Returns `201` with the created goal (including progress).

```json
{
  "title": "Kyoto Hyatt stay",
  "targetPoints": 80000,
  "targetDate": "2026-12-01",
  "accountIds": ["9f8d1c2e-..."],
  "notes": null
}
```

### `PATCH /api/v1/goals/{id}`

Partial update (`title`, `targetPoints`, `targetDate`, `accountIds`, `status`, `notes`). Returns the updated goal.

### `DELETE /api/v1/goals/{id}`

Delete a goal. Returns `204`.

### `POST /api/v1/demo`

Seed a sample portfolio (five programs, balance history, Kyoto trip goal) when the user has no linked accounts. Returns `201` with `{ "accountIds": [...], "goalId": "..." }`. Fails with `DEMO_PORTFOLIO_NOT_EMPTY` if accounts already exist.

### `GET /api/v1/shares` / `POST /api/v1/shares` / `DELETE /api/v1/shares/{id}`

Manage privacy-preserving share links. Create accepts `{ "label"?, "expiresInDays"? }`. Public consumers resolve tokens via `GET /api/v1/public/share/{token}` (unauthenticated) or the `/share/{token}` page — totals and program names only, never membership numbers.

### `GET /api/v1/loyalty-accounts/deleted` / `POST /api/v1/loyalty-accounts/{id}/restore`

Soft-deleted accounts remain restorable for 7 days. Unlink sets `deletedAt` instead of hard-deleting; restore clears the tombstone and reappears on the dashboard.

### `POST /api/v1/assistant/chat`

Grounded portfolio assistant. Body: `{ "message": "...", "history"?: [{ "role": "user"|"assistant", "content": "..." }] }`. Returns `{ "reply": "..." }`. Uses an OpenAI-compatible LLM when `LLM_API_KEY` is set; otherwise a heuristic advisor. Errors: `INVALID_ASSISTANT_MESSAGE`, `ASSISTANT_UNAVAILABLE` (503).

### `GET /api/v1/value-advice`

Bang-for-buck view: ranked transfer options from the user's balances plus curated (and previously scraped) deals with realized ¢/pt and affordability. Transfers use the saved card selection and dated eligibility resolver. Unknown or unverified conditional rules return eligibility warnings rather than numeric yields. Transfer DTOs optionally include `bonusVerified` and `bonusSource` (`manual|scraped|user`); a missing/null verification flag is unknown, not verified. The dashboard marks an applied bonus unverified unless that flag is explicitly true. No-bonus options are separate from unverified bonuses.

### `GET /api/v1/optimizer/plan`

Ranked redemption plans for the caller's balances (see [optimizer.md](./optimizer.md)). Query: `goalKind` (`flight|hotel|any`), `targetProgramId`, `minValueCpp`, `quantity`, `limit`, and optionally `origin`, `destination`, `dateFrom`, `dateTo`, `cabin` (all five together) to attach real award space when a search source is configured. Each plan has `steps`, `sources` (points used per program), `effectiveCentsPerPoint`, `shortfall`, `expiryUrgency`, `confidence`, `caveats[]` and `availability` (null unless real data was returned). Scope `portfolio:read`. Errors: `INVALID_REDEMPTION_GOAL`.

### `GET /api/v1/deals/sweet-spots`

The curated, **unverified** sweet-spot catalog (typical points ranges, estimated ¢/pt, constraints, confidence). Filters: `kind`, `programId`. Scope `portfolio:read`.

### `GET /api/v1/transfer-bonuses` / `POST /api/v1/transfer-bonuses`

Active transfer bonuses; **crowd/manual data, empty by default**. `GET` requires `portfolio:read` and returns shared manual/scraped or verified entries plus the caller's own unverified user reports. `POST` (scope `portfolio:write`) body `{ fromProviderId, toProviderId, bonusPercent, startsAt, endsAt, sourceUrl? }` records a bonus as `source: "user"`, unverified and attributed to the caller. That report affects only the reporter's advice and plans until trusted verification; the public request cannot set source or verification. There is no public verification endpoint. Emits `transfer_bonus.recorded`. Errors: `INVALID_TRANSFER_BONUS`.

### `POST /api/v1/deals/scrape`

Scrape a deal / award-chart URL via Firecrawl (or the stub scraper). Body: `{ "url": "https://...", "providerId"? }`. Returns `{ "ingest": { pageTitle, deals, markdownExcerpt }, "advice": { transfers, deals } }` with the new candidates folded into ranking. Errors: `INVALID_SCRAPE_URL`, `SCRAPE_FAILED` (502).

### `GET /api/v1/loyalty-accounts`

All linked accounts with their latest balances and balance trends (change vs. previous snapshot, 30-day, and 90-day baselines).

```json
[
  {
    "id": "9f8d1c2e-...",
    "provider": { "id": "united", "kind": "airline", "displayName": "United Airlines", "pointsCurrency": "MileagePlus miles", "estimatedCentsPerPoint": 1.2 },
    "membershipNumber": "MP123456",
    "hasStoredCredential": true,
    "latestBalance": { "points": 48320, "source": "sync", "capturedAt": "2026-07-08T14:03:00.000Z" },
    "estimatedValueCents": 57984,
    "trend": {
      "sincePrevious": { "points": 1820, "percent": 0.039 },
      "since30Days": { "points": 5200, "percent": 0.121 },
      "since90Days": null
    },
    "createdAt": "2026-06-01T09:00:00.000Z"
  }
]
```

`percent` is a fraction of the baseline (`null` when the baseline is zero). Missing baselines (no prior snapshot, or no history that old) are `null`.

### `POST /api/v1/loyalty-accounts`

Link a program membership. Returns `201` with `{ "accountId": "..." }`.

```json
{
  "providerId": "united",
  "membershipNumber": "MP123456",
  "credentialRef": "op://travel/united-login"
}
```

`credentialRef` is optional — a pointer into a credential vault (e.g. a 1Password reference), never a password. `cardProductId` is an optional nullable explicit transfer-card selection, validated against the program; omission/null leaves a new account unknown. It does not establish card ownership or issuer access. The currently supported choices belong to Chase Ultimate Rewards; see [dated rule behavior](transfer-eligibility-plan.md).

### `GET /api/v1/loyalty-accounts/{id}`

One account (same shape as the list entries). `404` if the account does not exist or belongs to another user.

### `PATCH /api/v1/loyalty-accounts/{id}`

Partial update; omitted fields are unchanged, `"credentialRef": null` clears the stored reference. `cardProductId` omission preserves the current selection; explicit null clears it to unknown. Returns the updated account.

```json
{ "membershipNumber": "MP999999", "credentialRef": null }
```

### `PATCH /api/v1/loyalty-accounts`

Bulk-edit membership numbers across many accounts in one request (up to 100). Applies each item independently — an item that fails (e.g. an account the caller doesn't own) is reported rather than failing the whole batch.

Request:

```json
{ "updates": [
  { "accountId": "acc_1", "membershipNumber": "MP999999" },
  { "accountId": "acc_2", "membershipNumber": "DL123456" }
] }
```

Response:

```json
{ "updated": 1, "failures": [
  { "accountId": "acc_2", "code": "LOYALTY_ACCOUNT_NOT_FOUND", "message": "..." }
] }
```

### `DELETE /api/v1/loyalty-accounts/{id}`

Soft-delete the account, retaining history during the existing restore window. Final purge after that window removes dependent data. Returns `204` with no body.

### `GET /api/v1/valuations`

List the caller's custom cents-per-point overrides. Each account's `estimatedValueCents` (and the `customCentsPerPoint` field) reflects the override when one is set; portfolio summary, digests, and alerts all use it.

```json
[ { "providerId": "chase-ultimate-rewards", "centsPerPoint": 2.05, "updatedAt": "2026-07-09T14:03:00.000Z" } ]
```

### `PUT /api/v1/valuations/{providerId}`

Set (or replace) the caller's provider-wide US-cents-per-point override (`0 < v ≤ 100`, finite). Core rounds to three decimals and rejects values that round to zero. Returns the normalized saved valuation. The web account-detail form exposes Save custom value and Reset to catalog using the same use cases; its provider is derived from the owned account.

```json
{ "centsPerPoint": 2.05 }
```

### `DELETE /api/v1/valuations/{providerId}`

Clear the override, reverting the provider to its editorial valuation. Returns `204`.

### `GET /api/v1/watches` / `POST /api/v1/watches` / `DELETE /api/v1/watches/{id}`

Award watchlist: watch an award-chart or deal page and get notified (chat + email via the worker's daily `watch` job) when a redemption at or above your cents-per-point threshold appears — and again only when the best seen value improves.

```json
{ "url": "https://blog.example/hyatt-sweet-spots", "label": "Hyatt sweet spots", "minCentsPerPoint": 2 }
```

Returns `201` with the watch (including `bestSeenCentsPerPoint`, `lastCheckedAt`, `lastNotifiedAt`).

### `GET /api/v1/loyalty-accounts/{id}/balances`

Balance history, newest first. Query parameter `limit` (1–365, default 50).

```json
[
  { "points": 48320, "source": "sync", "capturedAt": "2026-07-08T14:03:00.000Z" },
  { "points": 45900, "source": "manual", "capturedAt": "2026-07-01T08:30:00.000Z" }
]
```

### `POST /api/v1/loyalty-accounts/{id}/balances`

Record a manually observed balance — useful for programs without an integration or credentials on file. Returns `201` with the created snapshot (`source` is always `"manual"`).

```json
{ "points": 52000, "capturedAt": "2026-07-01T08:30:00.000Z" }
```

`capturedAt` is optional (defaults to now) and lets users backfill a balance they observed earlier. It must be a strict ISO-8601 UTC timestamp and must not be in the future (`INVALID_CAPTURE_TIME`).

### `POST /api/v1/loyalty-accounts/{id}/sync`

Fetch the current balance from the provider and append a snapshot. Credentials resolve in priority order: one-time `transientCredential` in the body (sourced from Apple Keychain / Chrome credential store on device, never persisted), then the server-side vault via the account's `credentialRef`.

```json
{ "transientCredential": { "username": "traveler@example.com", "secret": "..." } }
```

Returns the new snapshot: `{ "points": 48320, "source": "sync", "capturedAt": "..." }`.

### `POST /api/v1/sync`

Best-effort sync of every linked account. One failing provider never blocks the rest; each account reports its own outcome.

```json
[
  { "accountId": "9f8d1c2e-...", "ok": true, "balance": { "points": 48320, "source": "sync", "capturedAt": "..." } },
  { "accountId": "1a2b3c4d-...", "ok": false, "errorCode": "CREDENTIAL_UNAVAILABLE" }
]
```

## Using the typed client

```ts
import { createPointUpClient } from "@pointup/api-client";

const client = createPointUpClient({ baseUrl: "https://app.example.com" });

const summary = await client.getPortfolioSummary();
const accounts = await client.listLoyaltyAccounts();
const history = await client.getBalanceHistory(accounts[0].id, 90);
await client.recordManualBalance(accounts[0].id, { points: 52000 });
await client.syncAllLoyaltyAccounts();
```

All methods throw `PointUpApiError` (with `status` and `code`) on non-2xx responses.

### `POST /api/v1/agent/observations`

Submit a consented balance reading with `observations:write`; creating a missing
account additionally requires `portfolio:write` and a membership number. JSON
requests are limited to 32 KiB. Optional `captureId` is a UUID retained before
submission; optional `sourceMethod` is `page_capture` or `manual_entry`. Retain
the original `observedAt`, reviewed points, exact `sourceUrl`, agent label and
auto-link input across retries. Sources require HTTPS, an exact skill-listed
host, no credentials and the default TLS port. Capture time must be finite
and nonfuture for every outcome. Source/method remain claims, not proof of a
provider visit. Trusted credential and consent provenance cannot be supplied
in JSON and remains private.

The result retains `outcome`, `accountId`, `points`, `previousPoints`, `message`
and nullable `reviewId`, and adds `observationId` for receipt recovery. Outcomes
remain `recorded`, `unchanged`, `needs_review`, and `rejected`. For a timeout or
lost response, retry the same capture UUID and canonical payload. Exact retries
recover the same owner's current receipt without another balance or event,
even after an intervening balance or human resolution. Current token scopes
and provider consent must still authorize recovery; credential rotation does
not rewrite the receipt's original witnesses. Changed claims under the same
UUID return `OBSERVATION_REPLAY_CONFLICT` (409); do not automatically replace or
drop the key to bypass this. Legacy requests without a UUID retain their
existing admission semantics without stable replay recovery.

Confirmation and rejection remain browser-session-only at
`POST /api/v1/agent/observations/{id}/confirm` and `/reject`; bodyless requests
or strict empty JSON are accepted. Confirmation requires an active owned
account, unchanged baseline and unexpired 24-hour deadline after lock waits
and write staging. New receipts compare snapshot identity; historical receipts
with unknown witnesses retain a protected points comparison. Expired readings
may still be rejected as cleanup. Neither action is exposed as an agent tool.
