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
| `PROVIDER_NOT_SUPPORTED` | 422 | Provider id is not in the catalog |
| `INVALID_MEMBERSHIP_NUMBER` | 422 | Membership number is blank |
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
| `INVALID_ASSISTANT_MESSAGE` | 422 | Chat message empty or too long |
| `INVALID_SCRAPE_URL` | 422 | Scrape URL is not absolute http(s) |
| `ASSISTANT_UNAVAILABLE` | 503 | LLM provider failed |
| `SCRAPE_FAILED` | 502 | Page scraper failed |
| `CREDENTIAL_UNAVAILABLE` | 409 | Sync needed credentials but none were resolvable |
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

Bang-for-buck view: ranked transfer options from the user's balances plus curated (and previously scraped) deals with realized ¢/pt and affordability.

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

`credentialRef` is optional — a pointer into a credential vault (e.g. a 1Password reference), never a password.

### `GET /api/v1/loyalty-accounts/{id}`

One account (same shape as the list entries). `404` if the account does not exist or belongs to another user.

### `PATCH /api/v1/loyalty-accounts/{id}`

Partial update; omitted fields are unchanged, `"credentialRef": null` clears the stored reference. Returns the updated account.

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

Unlink the account. Balance history cascades at the database layer. Returns `204` with no body.

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
