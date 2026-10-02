# ChatGPT identity linking and independent sign-in

This milestone adds authenticated ChatGPT account linking. Clerk remains PointUp's identity/session authority and portfolios keep their existing branded user IDs. `/dashboard/settings` describes the connection as linking; the signed-out UI does not advertise an independent ChatGPT login. Identity linking does not grant loyalty-account access, ChatGPT conversations or subscription inference. Assistant billing/provider configuration stays separate.

## Current flow

`GET /api/auth/chatgpt` reports configured/linked status. `POST /api/auth/chatgpt` starts a ten-minute transaction with state, S256 PKCE and nonce. Status, start and callback routes use PR14's `withAuthenticatedUser` boundary with `portfolio:read` and `sessionOnly:true`; explicit personal-token and Clerk-bearer credentials cannot borrow an ambient cookie session. Shared authentication, rate limiting, CSRF and request telemetry stay in place. Start additionally checks the registered HTTPS callback origin.

A Secure, HttpOnly, SameSite=Lax `__Host-pointup-chatgpt` cookie contains only a random browser transaction identifier. The verifier and nonce remain server-side in PostgreSQL, bound to the signed-in owner. The callback atomically deletes the transaction before validating its state, expiry and unchanged owner. Duplicate state/code parameters and denied authorization fail before token exchange. ID-token verification requires trusted signature, issuer, audience, expiry and matching nonce. No email-based account resolution occurs.

The mapping key is `(issuer, client_id, subject)`. Database uniqueness prevents moving an identity between PointUp accounts or replacing an existing owner's identity. No ID, access or refresh tokens are retained. The callback clears its browser cookie on success, failure and rejected authority, sends private/no-store and no-referrer headers, and renders only generic feedback. Application logs contain fixed failure stages and bounded provider status/request references, never token bodies, codes, verifiers, user IDs or raw exceptions. PR14's existing support header and telemetry remain available.

Storage reuses `getContainer().db`, including the existing PostgreSQL pool, TLS and transaction-pooler/prepared-statement tuning. It does not create a separate pool or execute runtime DDL. Linking is disabled under dev authentication and until complete client settings are present.

## Prerequisites for enabling linking

The [official OpenAI website guide](https://developers.openai.com/siwc/website) currently describes limited commercial-partner availability. Obtain an approved OAuth client through the [client-ID process](https://developers.openai.com/siwc/request-client-id), with the exact registered callback `https://<host>/api/auth/chatgpt/callback` for each environment and its token-endpoint authentication method.

Configure server-only `CHATGPT_CLIENT_ID`, `CHATGPT_REDIRECT_URI`, `CHATGPT_CLIENT_AUTH_METHOD=none|client_secret_basic` and, for a confidential client, `CHATGPT_CLIENT_SECRET`. Public clients use no secret; an inference API key is not a client secret. Local use also requires registered HTTPS; Secure cookies are never weakened.

Apply managed migration `0017_chatgpt_identity.sql` using the migration role before enabling the feature. The authoritative journal belongs to the core migration pipeline. Runtime permissions must permit transaction SELECT/INSERT/DELETE and identity SELECT/INSERT/UPDATE while retaining the migration's RLS and privilege restrictions. Use only a trusted server role appropriate for those restrictions; browser roles must have no table access. Starting a flow deletes expired transactions; deployments needing cleanup without new flows should schedule expiry deletion. No production migration or approved-client authorization round trip was performed during this port.

OIDC discovery comes from `https://auth.openai.com/.well-known/openid-configuration`; issuer and endpoint origins are restricted to OpenAI's production issuer. Network operations have bounded timeouts. Configure proxy and access logs to omit callback query strings and authorization headers.

## Completing independent sign-in

OpenAI's website flow supplies a verified external identity; the application must resolve an account and establish its own session. The implemented linking callback requires an existing session and never creates one. Missing approved-client access is a deployment prerequisite, not evidence that independent sign-in works.

A concrete supported Clerk integration route is a [custom OIDC social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider). Clerk documents a custom provider for all users, discovery/manual endpoints, client credentials, claim mapping, authorized redirect URLs and a PKCE toggle. Configure the OpenAI discovery URL and enable PKCE; register the exact redirect URLs Clerk supplies with the approved OpenAI client. Confirm the provisioned OpenAI authentication method matches Clerk's configuration. These sources establish a supported OIDC mechanism, not a tested built-in ChatGPT provider or approved compatibility for this installation.

Before implementing standalone UI, review [Clerk's OAuth account-linking behavior](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking): it may associate accounts by verified email, while PointUp's current mapping requires explicit signed-in linking by issuer/client/subject. Establish how the custom provider reconciles existing mappings without moving portfolios or treating email equality as consent. Do not default a missing `email_verified` claim to true. Confirm new-user onboarding, MFA/enterprise SSO requirements and any required existing-account confirmation before enabling the provider.

The next implementation is a configured Clerk custom-provider sign-in through Clerk's supported UI or OAuth flow, followed by reconciliation of the verified external identity with the current mapping and a stable Clerk `UserId`. Cover existing/new accounts, different emails, conflicting links, revoked identities, MFA/SSO-required sessions, logout and session rotation. Retain normal Clerk session issuance rather than minting backend sign-in tickets as an unreviewed bridge. [Clerk's sign-in-token API](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token) exists, but its existence does not establish the required policy guarantees for this flow.

## Verification boundaries

Focused tests use local signing keys, mocked provider responses and controlled database handles. They check PKCE/nonce/state, token authentication, trusted ID-token verification, callback rejection, browser-only route options, cookie clearing, owner binding, private failures and parameterized atomic-consume/storage SQL. Seven additional tests use the real PostgreSQL driver to verify hashed transaction storage, one-time consumption under concurrency, owner/subject uniqueness under concurrent linking and expiry cleanup. Ten isolated migration tests verify legacy adoption and atomic rejection of incompatible tables. The managed migration also passed on the release-owned PostgreSQL fixture. These checks do not establish approved OpenAI admission, real-client consent, production database state, Clerk custom-provider compatibility or independent login. Deployment smoke checks remain separate validation.

## Server deployment configuration

The native `.env-example` and Docker `.env.docker.example` list the optional OAuth
settings as commented values. Docker passes them only to the web server at runtime;
they are absent from image build arguments, worker/bot/MCP environments and browser
or extension configuration. Default Docker authentication is `dev`, so linking stays
disabled even if OAuth values are supplied. Enable Clerk with real Clerk settings,
set `APP_URL` to the registered HTTPS origin and configure a trusted HTTPS ingress
before testing a browser transaction. Plain localhost HTTP cannot carry the Secure
transaction cookie required by this flow.

For the ECS web service, CDK provides a separate opt-in:

```text
-c enableChatGptLinking=true
-c chatGptClientId=<approved-OAuth-client-id>
-c chatGptRedirectUri=https://<registered-host>/api/auth/chatgpt/callback
-c chatGptClientAuthMethod=none
```

Use `chatGptClientAuthMethod=client_secret_basic` only when that is the provisioned
client's authentication method. CDK then creates a placeholder Secrets Manager
secret and exposes its ARN as `ChatGptClientSecretArn`. Populate that secret with
the approved OAuth client secret before live linking; a generated placeholder is
not a usable provider credential. Do not pass the secret as CDK context or reuse
an assistant inference API key. ECS injects `CHATGPT_CLIENT_SECRET` only into the
web task, with the existing scoped execution-role secret permissions.

CDK rejects an enabled deployment without all three registration settings, or
with an HTTP callback, wrong callback path, credentials, query or fragment. It
sets the web task's canonical `APP_URL` to the callback origin. Production CDK
requires the web domain and ACM certificate and provisions HTTPS ingress; the
operator must verify certificate, DNS and callback ownership before activation.
Infrastructure does not establish OpenAI client approval. Missing or false
`enableChatGptLinking` provisions no OAuth secret or client environment values.
The existing migration, trusted server-role permissions, functioning Clerk
session and approved-client prerequisites still apply. This deployment option
enables authenticated identity linking; it does not create standalone ChatGPT
sign-in or establish a verified authorization round trip.

The GitHub deployment workflow reads optional nonsecret repository variables
`ENABLE_CHATGPT_LINKING=true`, `CHATGPT_CLIENT_ID`, `CHATGPT_REDIRECT_URI` and
`CHATGPT_CLIENT_AUTH_METHOD` and passes them as those CDK context values. Leaving
the flag unset or false keeps linking deployment configuration absent. Set all
registration values before enabling the flag; CDK validates the HTTPS callback
and client authentication method. `CHATGPT_CLIENT_SECRET` is never passed through
the workflow or a repository variable: populate the provisioned Secrets Manager
secret through the approved secret-management process before live linking.
