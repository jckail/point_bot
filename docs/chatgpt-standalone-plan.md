# Standalone ChatGPT sign-in design and acceptance plan

Status: proposed design, 2026-10-02. Standalone sign-in is **not implemented**.
The existing milestone implements authenticated identity linking only. Approved
OpenAI website client access and tested Clerk compatibility are required before
enabling the Clerk website design below. The separate open-source plan-usage flow
has different registration/runtime gates, assessed at the end of this document.
Local implementation can proceed behind a disabled feature flag;
the flag must not advertise a working login or enable a provider prematurely.

The intended outcome is that an enrolled returning user can choose Continue with
ChatGPT while signed out and receive a normal Clerk session for their existing
PointUp account. Eligible new users can onboard under an explicit product policy.
Existing portfolios, branded user IDs, MFA and enterprise restrictions remain
authoritative. Linking is preparation for this outcome, not its replacement.

## Current source and missing bridge

- [Current behavior](chatgpt-sign-in.md) documents linking and deployment gates.
- [Transactions](../apps/web/src/server/chatgpt/oidc.ts) require an existing owner;
  [start](../apps/web/src/app/api/auth/chatgpt/route.ts) and
  [callback](../apps/web/src/app/api/auth/chatgpt/callback/route.ts) require browser
  cookie authority. They do not create a session.
- [Storage](../apps/web/src/server/chatgpt/storage.ts) persists an immutable owner
  mapping keyed by issuer, client ID and subject.
  [Migration 0017](../packages/core/drizzle/0017_chatgpt_identity.sql) also prevents
  two subjects for the same issuer/client/owner. Keep those guarantees.
- That SQL mapping is separate from a verified **Clerk external account**. The
  callback creates no Clerk enrollment. Existing linked users therefore need an
  explicit enrollment/reconciliation step before standalone returning sign-in.
- [Web authentication](../apps/web/src/server/auth.ts) resolves Clerk sessions;
  [signed-out navigation](../apps/web/src/components/clerk-nav.tsx) uses Clerk UI.
  There is no independent ChatGPT session issuer or reconciliation guard today.

## Candidate provider integration and compatibility gate

Use a Clerk custom OIDC social connection with normal Clerk session issuance.
Configure the approved OpenAI discovery endpoint and enable PKCE. Do not invent
a built-in ChatGPT provider or assume OpenAI client approval provisions Clerk.
Clerk documents custom connections, claim mappings and omitted mappings, but
does not establish this installation's OpenAI compatibility. Its setup lists
client credentials; confirm the exact provisioned token-authentication method
works rather than assuming public-client `none` support.
[Clerk custom-provider documentation](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider)

**Required acceptance gate:** leave the upstream email mapping absent, retain
the verified subject, and demonstrate that the actual Clerk instance supports
subject-only enrollment, returning sign-in and permitted new-user onboarding.
Do not map a missing `email_verified` to true or manufacture a verified email.
Do not configure an unnecessary user-info endpoint that overrides ID-token
claims. If Clerk requires an email, derives one despite the mapping, or cannot
support the intended user model, keep the feature disabled and obtain a supported
integration design from Clerk. These behaviors cannot be established by mocks.

Clerk documents automatic association of verified-email matches, including
bypassing password verification. A callback-only reconciliation check runs too
late to prevent that session from being issued. No documented general switch
disabling this behavior was established in the assessment. Thus directly mapping
the OpenAI email does not satisfy PointUp's explicit-owner policy.
[Clerk OAuth account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)

## Existing-owner enrollment and authoritative reconciliation

1. An existing owner signs in through their normal Clerk method. Require fresh
   Clerk reverification before adding the ChatGPT connection; existing bearer
   JWTs or PATs cannot authorize the PointUp enrollment mutation.
2. Use Clerk's documented `user.createExternalAccount` flow with the configured
   `oauth_custom_<key>` strategy, wrapped in `useReverification`. Clerk handles
   the provider authorization and verification. A previous SQL link alone is
   insufficient.
3. On return, the server authenticates the current owner and obtains the external
   account from authoritative Clerk backend data. Require its configured provider
   identity, verified status and `providerUserId`; never accept a subject, owner,
   verified flag or provider configuration from browser JSON or editable metadata.
4. Resolve issuer and OpenAI client ID from the allow-listed server configuration
   for that exact Clerk connection. Those values may not be present on Clerk's
   external-account object; do not invent them or infer them from email. Establish
   and test that `providerUserId` is the verified OpenAI subject for this connection.
5. Reconcile `(issuer, client_id, subject)` with the existing SQL owner. Matching
   mappings are idempotent; another owner or another subject for this owner fails
   closed. Never overwrite, merge or transfer portfolios automatically. A
   different OpenAI client requires fresh verified enrollment; do not assume its
   subject matches the previous client's subject.

Clerk documents this custom strategy and reverification flow.
[Clerk external-account enrollment](https://clerk.com/docs/guides/development/custom-flows/account-updates/manage-sso-connections)

Clerk and PostgreSQL are separate systems. Design a recoverable enrollment state,
not a fictional cross-system transaction: reconciliation failure must leave no
authorized PointUp enrollment. Retry only the same verified owner/identity, and
offer explicit cleanup of a partially attached Clerk connection. Do not silently
delete a pre-existing connection. Decide whether additional server-only enrollment
state requires an additive migration before implementation; preserve 0017 rows.

Every protected PointUp entry point must reject a conflicting or pending
reconciliation before portfolio access. Audit web/server-rendered reads, API,
extension Clerk bearer requests and token issuance, rather than protecting only a
redirect destination. Use authoritative backend state or a server-issued,
versioned witness with defined invalidation. An external account's presence alone
does not prove which method authenticated the current session; establish the
actual Clerk session evidence before relying on method-specific authorization.

## Returning login, new users and session policy

Returning users use Clerk's ordinary configured OAuth sign-in flow. Activate only
completed sessions and handle any required MFA/session tasks through supported
Clerk UI. No PointUp cookie may substitute for the Clerk session. Enterprise
requirements remain mandatory; route affected users to their existing enterprise
SSO instead of allowing a new ChatGPT-created account to bypass that requirement.
Clerk's custom flows explicitly handle `needs_second_factor` and session tasks;
production policy/settings still need verification.
[Clerk MFA flow](https://clerk.com/docs/guides/development/custom-flows/authentication/multi-factor-authentication)

Before enabling signup, define eligibility, invitation/enterprise restrictions,
required profile/contact recovery and consent. An unrecognized subject may create
a fresh Clerk/PointUp identity only under that policy. A matching email suggests
an existing-account confirmation flow; it never selects its owner. Require the
person to authenticate that existing account before enrollment. If the current
Clerk user model cannot support this onboarding without email association, signup
remains disabled until a compatible design is verified; do not weaken login to
claim complete onboarding.

OpenAI describes identity sign-in as verified external identity followed by
application-owned account resolution and sessions. Identity scopes do not grant
conversation or inference access; AI billing authorization stays separate.
[OpenAI SIWC quickstart](https://developers.openai.com/siwc/quickstart)

Do not implement a backend sign-in-ticket bridge as a shortcut. Clerk sign-in
tokens select a user and default to 30 days unless expiration is overridden;
their API establishes no MFA/enterprise-policy assurance. They are consumed once
through the ticket strategy. Clerk's testing documentation explicitly describes
backend-token sign-in as bypassing verification, including MFA. A short expiry
does not restore those guarantees.
[Token API](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token),
[ticket consumption](https://clerk.com/docs/react/guides/development/custom-flows/authentication/embedded-email-links),
[verification bypass](https://clerk.com/docs/guides/development/testing/playwright/test-helpers)

Unlink requires a reverified browser session, explicit intent and a recovery path
so the person cannot remove their only usable login accidentally. Define removal
ordering, partial-failure retries and session revocation across Clerk and SQL.
Do not let a stale SQL mapping authorize login after Clerk removal. Logout uses
normal Clerk logout/session revocation; it does not unlink the identity or promise
to log the person out of ChatGPT. Provider consent revocation behavior and its
effect on existing PointUp sessions need explicit tested policy, not an assumed
OpenAI revocation webhook.

## Required client and environment configuration

Obtain an approved website SIWC client through OpenAI's commercial-partner process.
Record the client ID, exact HTTPS redirect URLs per environment, issuer/discovery,
identity scopes and provisioned token-endpoint authentication method. Confidential
clients require a server-managed client secret; public clients do not. Register
the redirect URLs supplied by Clerk for this connection, not merely the existing
PointUp linking callback. Keep inference API keys separate and preserve secure
cookies, PKCE, nonce/state validation and one-time browser transactions on any
application-owned OAuth leg.
[OpenAI website flow](https://developers.openai.com/siwc/website),
[client registration](https://developers.openai.com/siwc/request-client-id)

Also record the stable Clerk connection key, exact configured provider/client
association, no-email claim mapping, allowed redirects, compatible user model,
MFA/enterprise policies and enabled signup behavior. Configuration must remain
disabled by default. Logs and callback access logs must omit tokens, codes,
verifiers, subjects and query strings; user feedback stays generic and private.

## Acceptance and implementation sequence

| Boundary | Required evidence |
| --- | --- |
| Provider compatibility | Real approved client; subject-only mapping; correct token authentication, PKCE and redirects; verified provider subject matches server configuration. |
| Explicit ownership | Existing SQL link without Clerk enrollment refuses readiness; matching enrollment succeeds; same email/different subject never associates owners; different email/same enrolled subject returns the existing owner. |
| Conflicts and concurrency | Two owners racing for one subject yield one owner; changed client/subject requires enrollment; pending or conflicting reconciliation grants no portfolio access through any supported authentication surface. |
| Partial failure | Clerk attachment followed by SQL failure is recoverable without reassignment; retries remain idempotent; failed cleanup does not authorize enrollment. |
| New users | Eligible subject creates a fresh identity under onboarding policy; email matches require existing-account authentication; enterprise/invitation/signup restrictions cannot be bypassed. |
| Session policy | MFA-required account completes second factor; setup tasks remain pending until completed; enterprise-required accounts use required SSO; no ticket-based bypass. |
| Lifecycle | Returning signed-out login, logout/session rotation, reverified unlink, partial unlink failure, consent revocation and account deletion have defined effects and deny stale authority. |
| Privacy and redirects | No sensitive values in logs/URLs; redirects are allow-listed; failed/cancelled provider flows give private feedback without authorizing access. |

First implement disabled enrollment/reconciliation seams and focused refusal,
ownership/concurrency and recovery tests. Then validate the actual Clerk connection
and approved OpenAI client in a controlled environment, including real MFA and
enterprise cases. Only afterward enable returning login and the separately
approved signup policy. Mocked tests prove local behavior; they cannot establish
provider admission, subject-only compatibility or genuine production policy.

This plan authorizes no provider configuration change or release by itself.
Standalone sign-in remains an outstanding capability until implementation and
all acceptance gates are complete.

## Separate assessment: open-source ChatGPT plan usage

Current official documentation distinguishes limited commercial website identity
sign-in from ChatGPT plan usage available to all open-source partners. Do not apply
the website's partner-client approval gate to every local open-source client.
The plan-usage overview targets open-source/locally hosted apps and directs paid
or remotely hosted offerings to an interest form. Neither repository publicness
nor its name establishes eligibility. This worktree has no located LICENSE file
or declared package license; MIT licensing was not verified.
[Quickstart](https://developers.openai.com/siwc/quickstart),
[plan-usage overview](https://developers.openai.com/siwc/token-sharing-open-source)

Dynamic registration starts with `dynamic_agent_client`, a stable opaque
`ext_agent_host_id` and the actual app name. Persist the returned client ID per
verified user/workspace registration; it replaces the bootstrap ID in exchanges
and future sign-ins. No client secret or partner API key is needed. The documented
callback is HTTP `127.0.0.1`, with a listener started before authorization; only
its port may vary between attempts, and `localhost` is not interchangeable.
Validate state, PKCE, nonce and ID-token signature/issuer/audience/expiry before
activating the selected account. Request `resource=https://api.openai.com/v1`
and inspect granted `chatgpt.tokens.use.direct` before inference. This is not the
existing HTTPS Clerk/PointUp callback contract.
[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Credentials belong in protected local/self-hosted runtime storage, explicitly
outside browser storage. Preserve separate registrations, serialize rotating
refreshes, update credentials atomically and implement revocation-aware logout.
The current extension's [configuration](../apps/extension/src/config.ts) stores a
PointUp PAT/session token in `chrome.storage.local`; do not reuse that design for
OpenAI access/refresh/retained ID tokens.
[Accounts and credential security](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

PointUp's [MV3 manifest](../apps/extension/public/manifest.json) has only `storage`
permission and no native host. It cannot currently implement the documented local
listener. Chrome's identity flow uses a `chromiumapp.org` redirect, which is not
the specified loopback callback. A separately installed, reviewed native companion
could own the listener, credentials and inference, with an allow-listed extension
messaging boundary; Chrome documents native messaging, but no such companion is
implemented. Electron main-process examples do not establish browser-extension
support. Hosted web callbacks cannot substitute for the user's local listener;
a self-hosted runtime would need its own documented deployment/credential design.
[Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity),
[native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

The inference route also needs a separate compatible adapter: HTTP Responses
requires `store:false`, `stream:true`, supplied history and permitted instruction/
tool shapes; `max_output_tokens`, persistent response IDs and hosted MCP are
unsupported. Current [assistant runtime](../apps/web/src/server/assistant-agent/index.ts)
sets `maxTokens:1200` and uses a non-streaming runner call; do not simply replace
its inference API key with these OAuth tokens. Acceptance must inspect actual
SDK wire requests and prove stream completion, allowed local tool execution and
failure/refresh handling.
[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

A local/native plan-usage prototype can be designed without assuming partner-key
approval. Before implementation, settle licensing/eligibility, supported callback
runtime, protected storage and the inference adapter. It still supplies no Clerk
session or automatic authority over a PointUp portfolio: explicit account
reconciliation and normal Clerk MFA/enterprise policy remain separate requirements.
No registration, provider call or working plan-usage integration is claimed here.

### Current DevKit assessment

OpenAI now provides `@siwc/local` and `@siwc/react` as workspaces in its
[Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit).
The local helper is a candidate for companion OAuth, profiles and streaming;
the React package supplies connection controls. These are not established PointUp
dependencies or a hosted/browser-only integration. The example is a native macOS
app; PointUp's Windows/Linux packaging and Chrome bridge remain design work.

The DevKit uses a
[noncommercial license](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE),
not MIT. Its restrictions cover development with an anticipated commercial
application, even when no fee is charged. PointUp's separate repository licensing
decision does not resolve permission to incorporate this code. No DevKit code was
copied, installed or redistributed during this assessment.

Choose between a permitted DevKit-based local companion and an independently
authored implementation of the documented protocol after establishing intended
distribution and applicable permissions. Either approach still needs protected
native credentials, an authenticated browser/extension bridge, separate PointUp
authority and completed-inference acceptance. The
[official cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
provides an integration reference, not evidence that PointUp plan usage works.

For PointUp, an inference-only companion milestone can retain the existing
Clerk/PAT portfolio authorization while connecting a separately selected ChatGPT
profile. This is a proposed decomposition of PointUp's architecture: it does not
require completing the standalone Clerk login bridge first, and it does not
complete that remaining login capability. Pin both identities during each run;
switching either must cancel the run rather than retarget its tools. Preserve
browser-session approval for all proposals. Only sanitized connection state and
bounded operations should cross the companion bridge, never OAuth credentials.
