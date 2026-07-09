# PointBot chat surface

`point_bot` began as a bot, and this is its chat surface reborn on the modern
core. Two independent capabilities:

1. **Inbound commands** (`apps/bot`) — a Slack slash-command server that answers
   portfolio questions by calling `@pointup/core` use cases.
2. **Outbound digests** — the background worker (`apps/worker`) can post the
   weekly portfolio digest to Slack/Discord via the `Notifier` port, in
   addition to email.

Both consume the same domain core as the web app — no duplicated business
logic (hexagonal boundary: chat adapter → use cases → ports).

## Commands

Wire a Slack slash command (e.g. `/pointbot`) to the bot; the text after it
selects the action:

| Command | What it returns |
| --- | --- |
| `portfolio` (`balances`, `points`) | Totals + most valuable programs |
| `expiring` | Programs at risk of expiring, soonest first |
| `value` (`deals`, `transfers`) | Best transfer moves + affordable deals |
| `ask <question>` | Grounded answer from the assistant (`ChatWithAssistant`) |
| `help` | Command list |

Any unrecognized text is treated as a free-form assistant question.

The assistant uses the same provider selection as the web app
(`LLM_PROVIDER=bedrock` + `BEDROCK_MODEL_ID` → OpenAI-compatible via
`LLM_API_KEY` → heuristic fallback). See [docs/migration-from-pointup.md](./migration-from-pointup.md).

## Architecture

```
Slack slash command ──HTTP──▶ apps/bot
                                 │  verify signature (HMAC), parse, resolve user
                                 ▼
                         handleCommand()  ── pure router (unit-tested)
                                 │
                                 ▼
                @pointup/core use cases (ListLoyaltyAccounts,
                GetValueAdvice, ChatWithAssistant) → ports → Drizzle/Postgres
```

- `apps/bot/src/format.ts` and `commands.ts` are pure and unit-tested (no DB,
  no LLM) — the transport is a thin shell.
- `apps/bot/src/slack.ts` verifies Slack's request signature (`v0=` HMAC over
  `v0:timestamp:body`, 5-minute replay window) and parses the slash-command
  body — also unit-tested.
- Slow paths (a real LLM call) reply asynchronously via Slack's `response_url`
  so the initial request acks within Slack's 3-second window.

### User mapping

Slack identities map to app user ids one of two ways:

- **Self-hosted / personal** — set `BOT_DEFAULT_USER_ID` and every command runs
  as that single app user (the original PointBot model: a few named users).
- **Multi-user** — leave it unset and the Slack `user_id` is used as the app
  user id.

## Local development

```bash
# Assistant works on the heuristic fallback with no keys.
docker compose up -d db
npm run db:migrate
SLACK_SIGNING_SECRET=... BOT_DEFAULT_USER_ID=demo npm run dev --workspace @pointup/bot
# or: docker compose --profile bot up bot   (reads SLACK_SIGNING_SECRET, etc. from env)
```

`GET /health` returns `{"status":"ok"}`; Slack posts to `POST /slack/commands`.
For local Slack testing, expose the port with a tunnel (e.g. `cloudflared`,
`ngrok`) and set the slash-command Request URL to `<tunnel>/slack/commands`.

## Outbound digests to chat

Set either/both incoming-webhook URLs and the worker's `digest` job posts a
compact digest to them alongside email:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... \
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
  npm run dev --workspace @pointup/worker   # then: digest
```

In AWS, pass the webhook URLs to the digest task via CDK context:

```bash
npx cdk deploy -c slackWebhookUrl=https://hooks.slack.com/services/... \
               -c discordWebhookUrl=https://discord.com/api/webhooks/...
```

## Proactive alerts

Separate from the weekly digest, the worker's `alerts` job pushes **urgent,
actionable** items — and only when there's something to say (nothing fires for a
calm portfolio). Alerts are derived statelessly by `deriveAlerts` in the core
from the same digest read model:

- **Expiring / expired** points (within the warning window)
- **Balance drops / jumps** past a threshold (from each account's `trend`)
- **Goal reached** — enough points to book a trip goal

Delivery reuses the `Notifier` (Slack/Discord) and `Mailer` ports. Run it daily:

```bash
npm run dev --workspace @pointup/worker   # then: alerts
# or: docker compose run --rm worker alerts
```

Thresholds are tunable via `ALERT_EXPIRY_WARNING_DAYS` and
`ALERT_BIG_CHANGE_PERCENT`. In AWS the `AlertsTask` runs daily at 12:00 UTC.

## Deploying the bot

`Dockerfile.bot` builds a self-contained bundle (`node index.cjs`, port 8080,
`/health` for load-balancer checks). It is **not** yet provisioned as a Fargate
service in `infra/` — deploying it as a public HTTPS service (ALB + ACM cert so
Slack can reach it, with `SLACK_SIGNING_SECRET` from Secrets Manager) is the
natural follow-up. The application, image, and local compose service are ready.

Discord **inbound** interactions (ed25519-verified) are a future addition;
Discord is currently supported as an **outbound** digest channel.
