# ChatGPT identity linking

PointUp implements the identity portion of [Sign in with ChatGPT on your website](https://developers.openai.com/siwc/website). As documented on October 1, 2026, website sign-in is available to selected commercial partners through a limited trial. [Request a client ID](https://developers.openai.com/siwc/request-client-id) before configuring this integration. No registration or production OAuth sign-in has been performed by this change.

## Current behavior

A signed-in PointUp user can explicitly link their verified ChatGPT identity in Settings. Clerk remains the application identity and session authority; existing portfolios continue using their original Clerk user ID. This is account linking, not an independent ChatGPT login method. The signed-out sign-in screen must not advertise it as working standalone sign-in.

`POST /api/auth/chatgpt` creates a fresh ten-minute transaction with state, S256 PKCE and nonce. A Secure, HttpOnly, SameSite=Lax `__Host-` cookie stores only a random browser transaction identifier; PostgreSQL stores the verifier and binds the transaction to the current Clerk user. The POST checks Origin against the registered HTTPS callback origin. The callback atomically deletes the transaction before processing it, requires the same still-signed-in Clerk user, and verifies the OpenAI ID token signature, issuer, audience, expiration and nonce. Duplicate state/code parameters are rejected. Only fixed failure-stage labels and sanitized provider request IDs/status codes enter logs. Authorization failures clear the cookie and return an actionable generic Settings error.

The identity key is `(issuer, client_id, subject)`. Database uniqueness prevents moving a ChatGPT identity to another account or replacing a previously linked identity. No email-based account merging occurs. No OpenAI ID/access/refresh tokens are retained; no ChatGPT conversations or plan usage permissions are requested. Identity sign-in does not provide free inference or replace the Assistant's configured billing/provider.

## Deployment prerequisites

1. Obtain an OpenAI-issued client ID and its registered token-endpoint authentication method. Register the exact callback `https://<pointup-host>/api/auth/chatgpt/callback` independently for each environment.
2. Run the managed Drizzle migrations with a deployment/migration role. Migration `0008_agents_and_proposals.sql` now includes both ChatGPT tables and adopts existing tables created with [storage.sql](../apps/web/src/server/chatgpt/storage.sql). The standalone script remains a legacy reference; the journal is authoritative. Dedicated PostgreSQL fixtures verified blank-database creation and preservation of an existing identity mapping; no production migration has been applied. The runtime role needs SELECT/INSERT/DELETE on transactions and SELECT/INSERT/UPDATE on identity mappings. RLS is enabled without public policies, and PUBLIC plus existing Supabase anon/authenticated roles lose table privileges. Use a dedicated server-only table owner or appropriately restricted trusted role able to bypass RLS; never expose its database credentials to browsers. Schedule expired transaction deletion if abandoned flows must be removed when there are no later sign-ins; starting a flow also removes expired transactions.
3. Configure server-only `CHATGPT_CLIENT_ID`, `CHATGPT_REDIRECT_URI`, and `CHATGPT_CLIENT_AUTH_METHOD=none` or `client_secret_basic`, matching the provisioned client. For `client_secret_basic`, provide `CHATGPT_CLIENT_SECRET` through the secret manager. Public clients must not use a secret. Do not use an API key as the client secret.
4. Serve local development over HTTPS too. The integration deliberately does not weaken Secure cookies or allow unregistered/local HTTP callbacks.
5. Test a real approved-client round trip and database races before enabling the feature. Unit tests verify authorization construction, callback rejection, token authentication and ID token checks; they do not prove OpenAI admission or deployed database readiness.

Discovery uses `https://auth.openai.com/.well-known/openid-configuration` and requires that issuer and endpoint origins match OpenAI's production issuer. All exchanges remain server-side with bounded network timeouts. Outbound proxy/access logging should omit callback query strings and authorization headers.

## Completing independent ChatGPT sign-in

The [official OpenAI website guide](https://developers.openai.com/siwc/website) requires the application to resolve a verified identity and create its own session. This implementation intentionally stops at confirmed account linking. A future sign-in integration needs a reviewed Clerk-compatible OIDC/session bridge that respects the application's MFA and enterprise SSO policies, handles new-account onboarding, and resolves the same persisted identity mapping. Clerk sign-in tickets must not be introduced as an unchecked shortcut around those policies.

No official OpenAI documentation fetched for this implementation establishes a built-in Clerk SIWC provider or the required Clerk configuration. Do not assume that simply configuring these environment variables makes ChatGPT a Clerk login provider. First confirm a supported Clerk integration and its identity/session policy, then implement and test the session bridge. Existing Clerk sign-in and sign-out continue to own PointUp authentication.

## Checks before enabling

Verify missing/expired/replayed/mismatched state, changed Clerk user, denied consent and bad/ambiguous codes all fail before token exchange. Verify invalid token signature/issuer/audience/expiry/nonce fail before mapping. Confirm exact redirect registration and correct public/confidential authentication. Confirm concurrent callbacks consume a transaction once and concurrent links cannot reassign identities. Check that both success and failure delete the browser cookie, retain no provider token, and show useful Settings feedback. The integration is disabled until all required client settings are present; schema readiness remains a deployment prerequisite.
