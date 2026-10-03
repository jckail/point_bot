# Deferred bot reply transport

Slack and Discord commands can acknowledge a request before posting the final
private reply. These callbacks now constrain their destination and reject
redirects before portfolio text can be forwarded to another endpoint.

## Transport policy

Slack accepts HTTPS callbacks on exactly `hooks.slack.com` or
`hooks.slack-gov.com`, with no user information, nondefault port or fragment.
Explicit port 443 remains valid. Paths and query strings remain opaque.
Incoming signature verification and command authorization continue to run in
the request handler. Invalid destinations issue no HTTP request.

Discord retains its fixed `discord.com` API v10 original-reply endpoint.
Application IDs must be positive canonical uint64 snowflakes. Interaction tokens
are encoded as one path segment; empty tokens, standalone dot segments, control
characters and malformed Unicode are rejected. The 4,096-code-unit token limit
is a local resource bound. Replies retain the existing 2,000-character content
limit and ten-second timeout.

Both transports set `redirect: "error"`. Validation and transport failures keep
best-effort completion and emit a fixed warning without the exception, callback
URL, credential or reply text. HTTP error-status handling remains unchanged.

The contracts come from [Slack interaction responses](https://docs.slack.dev/interactivity/handling-user-interaction/),
[Slack webhook security](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/),
[Discord interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)
and [Discord snowflakes](https://docs.discord.com/developers/reference#snowflakes).

## Local evidence

On the preceding source `da9d9fb3e005bf4861cf6a4ddae20c19061b1e47`, local
CodeQL 2.27.1 / JavaScript queries 2.4.6 completed the workflow's
`security-extended` suite. Independent review verified successful extraction of
all 559 expected JavaScript/TypeScript files. Its two request-forgery findings
identified the unconstrained signed Slack callback and the signed Discord token
path. Slack authentication precedes the callback; Discord's destination origin
was already fixed. Review also identified raw transport-exception logging.

Actual tests against the original Discord export produced **20 failures**.
After the reviewed transport patch, the two transport files produced
**35 passing tests**:

```sh
agent-heavy-check -- npm exec --workspace=@pointup/bot -- vitest run \
  test/discord-transport.test.ts test/slack-transport.test.ts --maxWorkers=2
```

The tests exercise the real transport functions with mocked fetch. They verify
zero requests for rejected targets, encoded Discord paths, redirect policy,
content limits, bounded warnings and no automatic retry. No original Slack
regression is claimed through its newly exported function.

Type/lint qualification, the complete final-tree suite/builds, a new CodeQL
scan, actual redirect transport and live platform acceptance require their own
receipts. The preceding scan and broader passing checks qualify the preceding
source. All verification remains local through the shared owner and gate;
publication uses the supported `[skip ci]` route and does not trigger hosted CI.
