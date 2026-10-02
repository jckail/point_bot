# Public MCP OAuth and plugin onboarding plan

Status: independent source/documentation assessment, 2026-10-02. OAuth onboarding
is **not implemented or live verified**. This document changes no application
code, provider configuration or deployment. The existing PAT workflow remains
useful for manually configured clients; it is not a completed public OAuth flow.

## Verified current behavior and gaps

| Source | Current behavior / missing requirement |
| --- | --- |
| [HTTP adapter](../apps/mcp/src/http.ts) | Accepts only `Bearer pu_...`; forwards each caller's token to the API through a fresh request-scoped client. The prefix check is syntactic; the upstream API enforces real PAT authority when a tool accesses data. |
| [Protected-resource route](../apps/mcp/src/http.ts) | Publishes `/mcp` as resource but `authorization_servers: []`, with no `scopes_supported`. Its 401 instructs manual PAT creation. There is no discoverable OAuth issuer or consent/code exchange. |
| [Public URL selection](../apps/mcp/src/http.ts) | Falls back to `http://<Host>` when `publicUrl` is absent. Public OAuth needs a validated, configured canonical HTTPS resource; do not derive its identity from forwarded or caller-controlled headers. |
| [Tool registrations and errors](../apps/mcp/src/server.ts) | Include input/output schemas and annotations, but no `securitySchemes`. Tool failures produce text/`isError`, without OAuth challenge metadata. Transport 401 discovery and tool-level reauthorization are separate concerns. |
| [Web credential resolver](../apps/web/src/server/auth.ts) | Separates PATs and Clerk session JWTs; JWT agreement returns session-wide authority. This is not verification of a scoped Clerk OAuth access token. |
| [Scope policy](../apps/web/src/server/access-policy.ts) / [catalog](../packages/core/src/domain/agent/access-token.ts) | Existing permissions are `portfolio:read`, `portfolio:write`, `observations:write`, `consents:manage`. Browser-only mutations reject bearer authority. Preserve these semantics. |
| [Observation credential lock](../packages/core/src/infrastructure/repositories/drizzle-agent-repositories.ts) | PAT provenance and protected writes revalidate the live PAT under transaction locks. A new OAuth credential cannot be mislabeled as a session or PAT to bypass that requirement. |

## Public authorization contract

Implement OAuth 2.1 authorization code with S256 PKCE, public protected-resource
discovery, issuer discovery and supported token-authentication methods. Carry the
canonical resource through authorization/token exchange and enforce its audience,
owner, expiry and granted scopes on requests. Support an explicitly chosen CIMD,
predefined-client or DCR admission mode. Per-tool OAuth schemes and safe
`_meta["mcp/www_authenticate"]` errors must match actual permissions. Use the exact
client metadata/redirect URL shown by the OpenAI management page. Stable redirects
depend on RFC 9207 issuer-response support; otherwise use the supplied
callback-specific URL. Do not assume a stable callback or invent issuer support.
[Official OpenAI authentication requirements](https://developers.openai.com/plugins/build/auth)

This authorizes users to access PointUp; it is separate from ChatGPT identity
linking and ChatGPT plan-funded inference. OpenAI-managed mTLS can authenticate
the calling host, but cannot establish the end user's portfolio permission.
Production needs a stable reachable HTTPS Streamable HTTP endpoint, valid TLS,
safe logs and bounded execution. A private tunnel alone does not satisfy public
submission requirements.
[Official MCP server deployment guide](https://developers.openai.com/plugins/build/mcp-server)

## Preferred established-IdP integration

Start with **Clerk OAuth applications on the existing Clerk instance**. This
preserves the authenticated Clerk user ID used to own PointUp portfolios, without
email-based account matching or a second account authority. Clerk documents
custom OAuth scopes, their separate assignment/advertisement and explicit consent.
JWT and opaque token formats have different revocation behavior; choose and test
the required semantics instead of equating scope deletion with token revocation.
[Clerk OAuth implementation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)

Prefer explicitly allowed CIMD clients with only approved scopes; keep admission
of unknown clients disabled during the first release. Clerk documents S256 and
mandatory consent for CIMD, plus explicit client/scope admission. Avoid opening
DCR merely to make discovery work. A predefined registered client remains an
alternative where the host supports it.
[Clerk CIMD configuration](https://clerk.com/docs/guides/configure/auth-strategies/oauth/client-id-metadata-documents)

Use Clerk's supported OAuth access-token verification, which handles JWT and
opaque formats through `acceptsToken`; do not reuse the session JWT resolver or
decode unverified claims. Clerk also provides MCP authentication/discovery
helpers, but its Express/Next examples are not drop-in middleware for PointUp's
raw Node HTTP adapter.
[Clerk OAuth verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens),
[Clerk MCP integration](https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server)

**Compatibility gate:** demonstrate the actual instance preserves the MCP
`resource` value in verifiable token authorization/audience and supports the
selected OpenAI callback/client mode. The reviewed Clerk overview/example does
not establish resource binding or RFC 9207 response behavior for this instance.
Do not publish those capabilities without testing them. If they cannot be
configured, select an established MCP-compatible authorization server through a
separately reviewed Clerk federation/account-mapping design; do not build a new
authorization server or weaken audience checks as an improvised workaround.

## Request identity and backend integration

Introduce a distinct scoped OAuth principal: authoritative Clerk owner,
allow-listed issuer/client, verified resource and granted PointUp scopes, plus a
trusted credential/grant identity where protected writes need it. Unknown scopes
grant nothing; `openid`, `profile` or `email` alone grants no portfolio access.
Defaults for omitted client scope must be reviewed and minimal, never all writes.

The MCP adapter and API must preserve this authority end to end. Current forwarding
of an MCP-audience token to a different API resource is not automatically valid:
choose a documented resource/delegation boundary and verify it on both sides.
Do not convert OAuth tokens into cookie sessions, reuse a service-wide PAT, or
mint a stronger PAT to make existing routes accept them. Keep existing manual
PAT clients and their revocation behavior separate.

Enforce per-tool scopes through the same backend ownership/use-case checks. Keep
consent grants and observation/proposal approval/rejection browser-only; OAuth
consent does not grant provider capture consent. Observation submission requires
real credential provenance, current authorization and provider grant checks
within the existing atomic submission/replay seam. Design its credential type,
revocation witness and additive persistence needs before exposing write access.
Preserve existing direct mutation capabilities under their approved scopes;
defer OAuth writes until their full authorization path is implemented and tested.

## Acceptance and external onboarding gates

- Offline tests: exact canonical discovery/challenge URLs, tool scheme/scope
  correspondence, malformed/foreign/expired/revoked tokens, wrong audience,
  omitted/insufficient scopes, denied browser-only actions and private errors.
- Isolation tests: concurrent callers retain separate owners/tokens; resources
  and tools cannot cross accounts; an invalid credential cannot inherit a cookie
  or service token; OAuth verification fails closed on provider outages.
- Provider tests: real development-tenant code/PKCE flow, exact redirects,
  resource binding, granted scopes, consent denial, refresh/rotation/revocation,
  relevant MFA/session policy and selected callback issuer mode. No mock can prove
  those instance capabilities.
- Backend/PG tests before writes: credential/grant revocation during waits,
  provenance witness, scoped replay, browser-only approval refusal and atomic
  rollback using the production composition.
- Hosting gates: canonical domain/TLS, reachable public discovery, reverse-proxy
  behavior, applicable mTLS, stable transport and authenticated production smoke.
- Publication gates: verified domain, plugin package/metadata, successful tool
  scans and dedicated sample-data reviewer account. The portal requires review
  cases and submission approval; keep reviewer credentials private. Accommodate
  review access without weakening normal users' MFA policy.
  [Official submission process](https://developers.openai.com/plugins/deploy/submission)

Implementation can begin with disabled discovery/tool-policy/auth seams and
focused refusal/isolation tests. Provider settings, public hosting and submission
remain explicit external gates. A PAT-only endpoint or passing existing MCP tests
does not establish public OAuth onboarding or plugin approval.
