# Scoped agent access

PointUp personal access tokens (PATs) are durable, scoped credentials for a user-authorized agent or browser extension. They do not replace Clerk sessions or authorize a program login. The database stores only a hash of a high-entropy `pu_` token; its plaintext is returned once at minting. The maximum lifetime is 90 days. Revocation/expiry are checked against durable storage, not cached cookie identity.

## Authority boundaries

API requests with `Authorization: Bearer pu_...` resolve directly to the token's owner and granted scopes. Invalid, revoked, expired or malformed PATs fail closed even if the request also carries a valid Clerk cookie. Other bearer credentials require independent Clerk token verification and a matching identity from Clerk request authentication. Invalid bearer values cannot fall back to cookies or bypass the Origin check merely by header presence. A route without an explicit required scope rejects PAT access. Browser cookie mutations require an Origin matching the request origin and reject cross-site fetch metadata.

Management and approval endpoints reject **all Authorization headers**, including PATs and Clerk bearer tokens: use an actual first-party Clerk cookie session. Agents cannot mint their own tokens, grant themselves program consent, approve observations or execute staged proposals. Settings provides the user-facing management/review surface. These responses use `Cache-Control: private, no-store`, including error responses. No token, token hash, provider credential or raw upstream exception appears in diagnostic logging.

| Scope | PAT-authorized capability |
| --- | --- |
| `portfolio:read` | Read owner-scoped portfolio/account history, goals, watches, settings, valuations, advice and exports. |
| `portfolio:write` | Explicit account, goal, watch, settings and valuation CRUD. This scope does not authorize bypassing consent to write observed balances. |
| `observations:write` | Submit a provider/account-bound observation through `/api/v1/agents/observations`, subject to active account consent and anomaly/replay checks. |
| `assistant:chat` | Use the authenticated assistant and deal-analysis endpoints; configured upstream services can incur usage. |
| `actions:propose` | Propose a staged assistant action where the assistant integration supports it; user approval remains a separate browser-session step. |
| `sync:execute` | Reserved for reviewed, consent-bound program-sync APIs. Existing direct sync endpoints remain browser-session only. |
| `shares:write` | Reserved for reviewed sharing APIs. Existing share publication/revocation remains browser-session only. |

Direct manual balance POST, portfolio import, demo seeding and provider-sync mutations remain browser-session only because they can write balances outside the agent observation policy. Share publication/revocation is also browser-session only. Scopes are explicit in those handlers, but do not override the browser-only restriction. Additional server/browser operations retain their ordinary account ownership validation.

## Routes and contracts

All bodies are strict JSON schemas: unknown fields are rejected and body reads are bounded. Date inputs use ISO timestamps with timezone offsets. Account/token/consent/observation IDs must be UUIDs. The server supplies `userId` and observation `tokenId` from the authenticated principal; callers cannot select another owner or token.

| Method and route | Authentication | Request / response |
| --- | --- | --- |
| GET `/api/v1/agents/tokens` | Browser session | Token metadata array, without plaintext/hash. |
| POST `/api/v1/agents/tokens` | Browser session | `{label, scopes, expiresAt}` → 201 `{token, metadata}`; copy plaintext once. |
| DELETE `/api/v1/agents/tokens/:id` | Browser session | Owner-scoped revoke → `{revoked:true}`. |
| GET `/api/v1/agents/consents` | Browser session | Consent metadata array. |
| POST `/api/v1/agents/consents` | Browser session | `{accountId, expiresAt}` → 201 consent metadata; maximum lifetime 30 days. Provider binding derives from the owned account. |
| DELETE `/api/v1/agents/consents/:id` | Browser session | Owner-scoped revoke → `{revoked:true}`. |
| GET `/api/v1/agents/observations` | Browser session | Owner-scoped observation/review metadata array. |
| POST `/api/v1/agents/observations` | PAT with `observations:write` | `{observationId,accountId,providerId,points,capturedAt,sourceUrl,sourceMethod}` → observation metadata; 202 if held, otherwise 200. |
| POST `/api/v1/agents/observations/:id/review` | Browser session | `{decision:"approve"|"reject"}` → reviewed observation metadata. |

Token metadata: `id,label,scopes,createdAt,expiresAt,revokedAt,lastUsedAt`. Consent metadata: `id,accountId,providerId,grantedAt,expiresAt,revokedAt`. Observation metadata includes `id,accountId,providerId,points,capturedAt,sourceHost,sourceMethod,status,holdReason,createdAt,reviewedAt`; `status` is `accepted`, `held` or `rejected`. Dates serialize as ISO strings. Nullable timestamps indicate an action has not occurred.

Observation `points` must be a nonnegative safe integer. `sourceMethod` is `page_capture` or `manual_entry` (default `manual_entry`); vendor host/program and capture-time constraints are verified by the core use case. Reusing an observation UUID with the same canonical payload returns its existing result; changing its payload is a conflict. The durable ingestion transaction checks active token scope/owner, account/provider match and current program consent before recording an observation or balance. Held anomalies require explicit browser review. A consent grants permission to ingest an observation, not permission to bypass the provider's authentication or vendor terms.

Errors use `{error:{code,message}}` with 401 for authentication failure, 403 for denied scope/consent/browser authority, 409 for observation conflicts, 422 for agent input policy violations and 404 for missing owner-scoped records. Existing general JSON/media/body-size errors retain their status codes. Provider/credential failures are sanitized. Assistant request/trace response headers remain owned by the assistant handler.

## User flow and deployment

In Settings, choose scopes, an expiry and a useful device/agent label; mint a token and copy it once into the approved client. Prefer session-only client storage. A remembered PAT requires an explicit user choice and must never be exposed through a URL, logs, a public webpage or platform-wide configuration. Rotate by minting a replacement and revoking the old token. Account consent is a separate, time-limited user approval; revoking the token or consent stops subsequent observation writes. Signing out of Clerk does not revoke independent PATs.

Apply the core agent-token/consent/observation database migration before using these routes. The server role must retain required table privileges and RLS authority; browser roles must not read token storage or write authority records directly. Database connectivity/schema availability and actual Clerk browser/bearer flows require deployment smoke testing. No tokens or approvals have been issued automatically by this implementation.

Tests cover independent PAT selection, invalid/revoked/expired token failures without cookie fallback, absent write scope, rejection of bearer credentials at management/approval boundaries, malformed headers, same-origin/cross-site mutation checks, structured HTTP errors and private cache controls. Core tests separately cover hashing, lifetime/revocation, account/program consent, replay policy and anomaly review. These checks do not replace a live multi-instance database race test or client login smoke test.
