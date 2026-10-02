# PointUp

Track airline miles, hotel points, credit card rewards, and every other loyalty currency of value in one place. Built as a modern, fully-typed TypeScript monorepo with a framework-agnostic core (DDD / hexagonal architecture), a Next.js web surface, Drizzle ORM on PostgreSQL, and AWS infrastructure as code.

> **This is the `point_bot` repository.** PointUp is the modernized successor to
> the original Python/Selenium PointBot (now under
> [`legacy/python-selenium/`](./legacy/python-selenium/)). See
> [docs/migration-from-pointup.md](./docs/migration-from-pointup.md) for the
> port, the decisions behind it, and the AWS Bedrock (Claude Sonnet) assistant
> wiring.

| Layer          | Technology                                                                             |
| -------------- | -------------------------------------------------------------------------------------- |
| Core           | Native TypeScript domain/application/infrastructure layers (`@pointup/core`)            |
| Web surface    | [Next.js 16](https://nextjs.org/) App Router + [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/) |
| Data           | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) + drizzle-kit migrations        |
| Users          | [Clerk](https://clerk.com/) user management (email, social logins, MFA, user profiles)   |
| API client     | `@pointup/api-client` — typed, fetch-only, runs on web, mobile, and browser extensions  |
| Testing        | [Vitest](https://vitest.dev/) unit tests over ports-and-adapters fakes                  |
| Infrastructure | [AWS CDK](https://docs.aws.amazon.com/cdk/) — ECS Fargate, ALB, RDS PostgreSQL, Secrets Manager |
| CI             | GitHub Actions (lint, typecheck, test, build, plugin/spec validation, Playwright MCP smoke test, CDK synth, npm audit, CodeQL, Dependabot) |

## Documentation

- [docs/integration-status.md](./docs/integration-status.md) — native overhaul preservation, stacked integration, verification and remaining release gates
- [docs/local-development.md](./docs/local-development.md) — one-command Docker stack, dev auth mode, topology and how it scales later
- [docs/agents.md](./docs/agents.md) — MCP server, Claude plugin, ChatGPT Action, consented browser/computer-use write-back, security model
- [docs/supabase.md](./docs/supabase.md) — run on Supabase (pooler, TLS, RLS)
- [docs/security-review.md](./docs/security-review.md) — adversarial security review of the agent surface (findings + proposed patches)
- [docs/review.md](./docs/review.md) — codebase review: findings and status
- [docs/roadmap.md](./docs/roadmap.md) — feature roadmap: what's shipped, what's next, and how it's sequenced
- [docs/api.md](./docs/api.md) — full API v1 reference with request/response examples
- [docs/architecture.md](./docs/architecture.md) — DDD layering, SOLID mapping, workspace layout
- [docs/multi-surface.md](./docs/multi-surface.md) — adding mobile apps and browser extensions
- [docs/integrations.md](./docs/integrations.md) — loyalty providers (airlines, hotels, credit cards, rail, shopping) and credential vaults (1Password, Apple Keychain, Chrome)
- [docs/brand.md](./docs/brand.md) — brand kit: logo assets, color tokens, typography, voice
- [docs/migration-from-pointup.md](./docs/migration-from-pointup.md) — how the modernization was ported into `point_bot`, feature-parity checklist, and the Bedrock assistant
- [docs/release-backlog.md](./docs/release-backlog.md) — verified continuation and remaining release gates
- [docs/assistant-agent.md](./docs/assistant-agent.md) — shared web/extension Agents SDK, reviewed proposals and tracing privacy
- [docs/assistant-evaluations.md](./docs/assistant-evaluations.md) — synthetic evaluation cases and opt-in live evaluation
- [docs/bot.md](./docs/bot.md) — the PointBot chat surface: Slack/Discord commands, the `Notifier` port, digests, and deployment
- [docs/extension.md](./docs/extension.md) — the Chrome extension: capture balances from provider pages via `@pointup/api-client`

## Repository layout

```
├── apps/
│   ├── web/                  # Next.js app: pages, components, API routes, composition root
│   │   ├── src/components/   #   branded UI components (logo, cards, forms)
│   │   └── public/brand/     #   brand kit assets (SVG logomarks, lockup)
│   ├── worker/               # Background jobs: scheduled syncs + email + chat digests
│   ├── bot/                  # PointBot chat surface: Slack/Discord commands over the core
│   ├── mcp/                  # MCP server (stdio + stateless HTTP) over the API
│   └── extension/            # Chrome (MV3) extension: capture balances from provider pages
├── packages/
│   ├── core/                 # Domain + application + infrastructure (framework-free)
│   │   ├── src/domain/       #   entities, provider catalog, repository ports, errors
│   │   ├── src/application/  #   use cases + outbound ports (gateway, vault, clock)
│   │   ├── src/contracts/    #   zod wire schemas shared by all surfaces
│   │   ├── src/infrastructure/  # Drizzle repos, provider gateways, vault adapters
│   │   └── drizzle/          #   generated SQL migrations
│   └── api-client/           # Typed HTTP client for mobile / extension surfaces
├── plugins/
│   ├── claude/               # Claude Code plugin: skills, agent, commands, MCP config
│   └── chatgpt/              # ChatGPT Action spec generator + GPT config
├── e2e/                      # Playwright smoke test: MCP HTTP server vs a fake API (standalone package)
├── supabase/                 # Supabase local config (schema stays in Drizzle)
├── infra/                    # AWS CDK app (standalone package)
└── docs/                     # Architecture and integration guides
```

## Quick start (Docker, no accounts needed)

Requirements: Docker with Compose v2. No Clerk keys, no AWS.

```bash
docker compose up --build
```

Open <http://localhost:3000/dashboard> - there is no sign-in locally
(`AUTH_PROVIDER=dev`: one fixed, seeded demo user). The stack runs Postgres,
a one-shot migrate/seed job, the web app, the MCP server
(<http://localhost:8787/mcp>), the worker and Mailpit (<http://localhost:8025>).
`docker compose logs bootstrap` prints copy-paste MCP / Claude / ChatGPT
connection snippets with a ready-made dev token. Verify everything end to end:

```bash
npm run docker:smoke
```

Other commands: `npm run docker:up | docker:down | docker:reset |
docker:up:pgbouncer`. Topology, the dev-auth safety rules and how this scales
later: [docs/local-development.md](./docs/local-development.md).

## Native development

Requirements: Node.js >= 20 and Postgres (Docker is the easy way).

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment (.env-example sets AUTH_PROVIDER=dev: no Clerk keys needed)
cp .env-example .env

# 3. Start PostgreSQL
docker compose up -d db

# 4. Apply database migrations
npm run db:migrate

# 5. Run the dev server
npm run dev
```

### Root scripts

| Command               | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Start the Next.js dev server                             |
| `npm run build`       | Production build of the web app                          |
| `npm run lint`        | ESLint across the whole monorepo                         |
| `npm run typecheck`   | TypeScript checking in every workspace                   |
| `npm run test`        | Vitest unit tests (core use cases, no DB needed)         |
| `npm run db:generate` | Generate a new SQL migration from schema changes         |
| `npm run db:migrate`  | Apply pending migrations to `DATABASE_URL`               |
| `npm run db:studio`   | Open Drizzle Studio to browse the database               |
| `npm run docker:up` / `docker:down` / `docker:reset` / `docker:smoke` | Local Docker stack lifecycle and end-to-end smoke test |

### End-to-end smoke test

`e2e/` is a standalone package (not a root workspace) that starts the built MCP server in HTTP mode against a tiny fake PointUp API and drives the tools over HTTP with Playwright's request client. No browser, database or Clerk keys needed:

```bash
cd e2e && npm ci && npm test   # builds apps/mcp first (pretest)
```

### Database workflow

The schema lives in `packages/core/src/infrastructure/db/schema.ts`. After editing it:

```bash
npm run db:generate   # writes SQL to packages/core/drizzle/
npm run db:migrate    # applies it to DATABASE_URL
```

Commit the generated migration files — they are the source of truth for production.

To browse the database with an open-source admin UI ([Adminer](https://www.adminer.org/)):

```bash
docker compose --profile tools up -d   # http://localhost:8081
```

Drizzle Studio (`npm run db:studio`) is also available for a schema-aware view.

### Background jobs

The worker (`apps/worker`) runs the same core use cases outside the request path:

```bash
# Refresh every user's balances
docker compose run --rm worker sync

# Send portfolio digest emails (delivered to Mailpit locally)
docker compose --profile tools up -d       # Mailpit UI: http://localhost:8025
docker compose run --rm worker digest

# Apply pending database migrations (same job CI runs on deploy)
docker compose run --rm worker migrate
```

Without Docker: `DATABASE_URL=... npm run dev --workspace @pointup/worker -- sync`. Emails route through the `Mailer` port — [Mailpit](https://mailpit.axllent.org/) (OSS) over SMTP locally, AWS SES in production, or plain console logging when nothing is configured.

### User management

Users, sessions, sign-in flows, MFA, and profiles are handled by [Clerk](https://clerk.com/). Create an application in the Clerk dashboard and copy the publishable + secret keys into `.env`. The application database stores only Clerk user ids next to domain data — there are no local user/password tables to operate.

## API (v1)

All surfaces speak the same versioned API; shapes are defined in `@pointup/core/contracts`. See [docs/api.md](./docs/api.md) for the full reference with request/response examples.

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /api/health` | — | ALB health check |
| `GET /api/v1/providers` | — | Supported programs (airlines, hotels, credit cards, rail, shopping) |
| `GET /api/v1/summary` | session | Portfolio totals, per-kind breakdown, last sync |
| `GET /api/v1/export` | session | Download accounts + history (`?format=json\|csv`) |
| `POST /api/v1/import` | session | Rehydrate accounts + balances from a CSV export |
| `GET /api/v1/calendar.ics` | session | iCal feed of account expiration dates |
| `GET /api/v1/goals` | session | Trip goals with progress against balances |
| `POST /api/v1/goals` | session | Create a trip goal |
| `PATCH /api/v1/goals/{id}` | session | Update a trip goal |
| `DELETE /api/v1/goals/{id}` | session | Delete a trip goal |
| `POST /api/v1/demo` | session | Seed sample portfolio (empty accounts only) |
| `GET /api/v1/shares` | session | List privacy-preserving share links |
| `POST /api/v1/shares` | session | Create a share link |
| `DELETE /api/v1/shares/{id}` | session | Revoke a share link |
| `GET /api/v1/public/share/{token}` | — | Public portfolio snapshot (no membership numbers) |
| `GET /api/v1/loyalty-accounts/deleted` | session | Soft-deleted accounts in the restore window |
| `POST /api/v1/loyalty-accounts/{id}/restore` | session | Undo an unlink |
| `POST /api/v1/assistant/chat` | session | Grounded AI portfolio assistant |
| `GET /api/v1/value-advice` | session | Transfer rankings + bang-for-buck deals |
| `GET /api/v1/optimizer/plan` | session | Ranked redemption plans for your points (see docs/optimizer.md) |
| `GET /api/v1/deals/sweet-spots` | session | Curated, unverified award sweet-spot catalog |
| `GET` / `POST /api/v1/transfer-bonuses` | session | Active transfer bonuses (crowd/manual data) / report one |
| `POST /api/v1/deals/scrape` | session | Scrape a deal URL and re-rank advice |
| `GET /api/v1/activity` | session | Chronological activity feed |
| `GET /api/v1/expiring` | session | Accounts expiring within N days (default 90) |
| `GET /api/v1/loyalty-accounts` | session | Linked accounts with latest balances and trends |
| `POST /api/v1/loyalty-accounts` | session | Link a program membership |
| `GET /api/v1/loyalty-accounts/{id}` | session | One account with its latest balance |
| `PATCH /api/v1/loyalty-accounts/{id}` | session | Update membership number / credential ref |
| `DELETE /api/v1/loyalty-accounts/{id}` | session | Unlink the account (history cascades) |
| `GET /api/v1/loyalty-accounts/{id}/balances` | session | Balance history, newest first (`?limit=1..365`) |
| `POST /api/v1/loyalty-accounts/{id}/balances` | session | Record a manually observed balance |
| `POST /api/v1/loyalty-accounts/{id}/sync` | session | Fetch and record the current balance (accepts an optional one-time `transientCredential`) |
| `POST /api/v1/sync` | session | Sync every linked account; per-account outcomes |

Errors are uniform: `{ "error": { "code": "DUPLICATE_LOYALTY_ACCOUNT", "message": "..." } }` with stable codes from the domain layer.

## Deploying to AWS

Infrastructure lives in [`infra/`](./infra). Production releases use the candidate-first helper [`scripts/deployment/rollout.mjs`](./scripts/deployment/rollout.mjs), with mandatory TLS configuration checked by [`infra/lib/rollout-config.ts`](./infra/lib/rollout-config.ts). Use the protected deployment workflow described below; directly deploying the application stack would bypass its migration and backup gates.

The stack provisions a VPC, encrypted RDS PostgreSQL 17 in isolated subnets, Secrets Manager credentials, HTTPS ALB/Fargate services with health checks and deployment circuit breakers, candidate Docker assets in ECR, scheduled workers and CloudWatch alarms. Active web services start with two tasks and scale to six. An inactive first-create bootstrap instead has zero application service tasks, disabled schedules and zero scaling capacity. Database backup retention is seven days with deletion protection; high-availability changes to the database/network require a separately reviewed infrastructure rollout.

Required production settings:

| GitHub setting | Value |
| --- | --- |
| Secret `AWS_DEPLOY_ROLE_ARN` | Role emitted by the OIDC stack below |
| Secret `CLERK_PUBLISHABLE_KEY` | Real `pk_live_…` key, inlined into the candidate web image |
| Variable `AWS_REGION` | Approved deployment region; workflow default is `us-east-1` |
| Variable `WEB_CERTIFICATE_ARN` | Approved ACM certificate in the same AWS account and region |
| Variable `WEB_DOMAIN_NAME` | Approved public DNS hostname, without scheme, port or path |
| Variable `APPROVED_DATABASE_SNAPSHOT_ARN` | Operator-approved RDS snapshot required for every existing-stack migration, including later bootstrap activation |

The snapshot must be `available`, encrypted, completed within the preceding 24 hours, and belong to the exact live database (`DBInstanceIdentifier` and `DbiResourceId`) in the deployment account/region. Update the approved snapshot selection for each rollout; an ARN alone is not approval of an unrelated or stale backup. The helper verifies these conditions before launching migrations. Snapshot validation does not establish that a backup can be restored; verify the restore procedure separately.

The release sequence is:

1. Run the complete reusable CI gate. Discover the approved account and stack, synthesize the candidate, publish its assets and pin task images to ECR digests. Existing-stack upgrades must preserve protected database/network properties and existing resource identities.
2. For a first create only, prepare and verify an exact CREATE-only change set, then provision inactive resources. The helper confirms stack absence and validates that no service, schedule or scaling target becomes active. Ordinary upgrades do not update the existing stack before the migration gate.
3. Register and run a one-off Fargate migration task using the **candidate worker digest**, existing private network and real database secret. Under the migration lock, verify the candidate migration manifest and complete managed journal. Promotion requires the matching image digest, exit code zero and matching `journal_verified` log attestation.
4. First creation always stops at `inactive-awaiting-secret-readiness`, even if readiness was requested. Populate the real application secrets referenced by stack outputs, configure the HTTPS domain/Clerk origins and any enabled provider settings, and verify operator ownership/readiness. Generated Clerk/OpenAI/other secret placeholders are not working credentials.
5. Activate an existing inactive bootstrap only through a later protected `workflow_dispatch` with `bootstrap_ready=true`, after explicitly attesting that production secrets and TLS/DNS configuration are ready. That later run still needs its approved fresh database snapshot and candidate migration/journal gate. Regular pushes do not activate an unready bootstrap. Existing active deployments promote only after the same candidate migration gate succeeds.

`bootstrap_ready` records the operator's readiness attestation; it does not test credentials, certificate issuance, DNS resolution or provider access. The workflow uploads a nonsecret `pointup-release.json` artifact recording release progress, candidate hashes/digests and migration references. Inspect the owned migration task/logs and release artifact after a failure before retrying; do not bypass the gate with a separate deployment or manual schema reset.

Live AWS credentials, production configuration, first-create/upgrade execution and backup restoration remain **unverified** in this project session. Offline helper/infra tests and successful CI do not establish a live deployment.

### Optional service and assistant configuration

Set `ENABLE_MCP=true` together with `MCP_CERTIFICATE_ARN` and `MCP_DOMAIN_NAME` for the remote MCP service. Its certificate must also match the deployment account/region. Optional `MCP_POINTUP_URL` must be an approved HTTPS origin without credentials, path, query or fragment; otherwise it uses the configured web HTTPS origin. The stateless MCP adapter forwards each caller's own token and does not acquire browser review authority.

The MCP container binds `0.0.0.0`; host/origin controls remain configured by the service. `MCP_ALLOWED_HOSTS` protects against DNS rebinding; production browser origins are denied unless allowed. See [multi-surface documentation](./docs/multi-surface.md) for MCP behavior. Public production hosts require HTTPS; localhost HTTP instructions are for local development only.

For the Telegram bot, set `ENABLE_BOT=true` with `BOT_CERTIFICATE_ARN` and `BOT_DOMAIN_NAME`; `BOT_DEFAULT_USER_ID` is optional. For aggregator integration, set `ENABLE_AGGREGATOR=true` with an approved HTTPS `AGGREGATOR_API_URL` without embedded credentials or a fragment. Feature flags accept only explicit `true` or `false` values.

Optional repository variables include `DIGEST_FROM_EMAIL` for a verified SES sender, `ENABLE_AGENTS=true` with an explicit `ASSISTANT_MODEL`, and separate opt-in `ASSISTANT_TRACING_ENABLED=true`. Populate any enabled provider's real secret before activation. For identity linking, set `ENABLE_CHATGPT_LINKING=true` with approved `CHATGPT_CLIENT_ID`, `CHATGPT_REDIRECT_URI` and `CHATGPT_CLIENT_AUTH_METHOD`; this links an identity and does not replace PointUp sign-in. Use the current helper's supported configuration rather than ad hoc application `cdk deploy` commands.

### Continuous deployment

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) runs on pushes to `master` and manual dispatch. Its AWS job depends on the **complete** reusable [CI workflow](./.github/workflows/ci.yml): lint, hygiene, types, unit/real-PostgreSQL tests, migration/rollout tests, all builds, plugin/infrastructure contracts and Docker smoke. Releases are serialized without cancelling an in-progress deployment. Missing `AWS_DEPLOY_ROLE_ARN` still runs verification but skips AWS deployment.

Authentication uses GitHub OIDC; no long-lived AWS keys belong in repository secrets. Protect the `production` GitHub environment with the appropriate reviewers and branch/ref rules before configuring deployment. The role trusts the exact `repo:owner/name:environment:production` subject. Establish the CDK bootstrap and OIDC role using an authorized operator session in the selected account/region:

```bash
cd infra
npm ci

# One-time account/region bootstrap; this mode does not instantiate the app stack.
npx cdk bootstrap aws://<account>/<region> \
  -c deploymentMode=oidc -c githubRepo=<owner>/<repo>

# Create the GitHub federation stack independently of application rollout.
npx cdk deploy GithubOidc \
  -c deploymentMode=oidc -c githubRepo=<owner>/<repo>
```

Configure the emitted `DeployRoleArn` as `AWS_DEPLOY_ROLE_ARN`, then add the required TLS/Clerk/snapshot settings above. If the account already has a GitHub OIDC provider, reconcile/import it instead of creating another provider for the same issuer. The role's scoped permissions cover candidate inspection/publication, CDK bootstrap-role assumption, validated first-create change-set execution and migration registration/run/inspection; do not describe it as migration-only.

A manual dispatch with `verify_only=true` runs the entire release verification gate with **zero AWS deployment or migration calls**, even when credentials are configured. The AWS job and OIDC credential step are skipped; the helper also returns before AWS calls when `VERIFY_ONLY=true`. A later manual dispatch with `verify_only=false` and `bootstrap_ready=true` is the explicit activation request for an existing inactive bootstrap, subject to the protected environment and all rollout gates.

## Running the full stack in Docker locally

```bash
docker compose --profile app up --build
```

This starts PostgreSQL and the production image of the app on [http://localhost:3000](http://localhost:3000).

### OpenAI Agents SDK activation

The dashboard and Chrome extension share the server-side TypeScript Agents SDK
assistant. Existing provider selection remains the default. See
[assistant setup](docs/assistant-agent.md) and [evaluations](docs/assistant-evaluations.md).
For local use, configure `ASSISTANT_RUNTIME=agents`, `OPENAI_API_KEY`, and an explicit
`ASSISTANT_MODEL` in the server environment. Tracing requires separate opt-in.

For AWS, use the protected candidate rollout with repository variables
`ENABLE_AGENTS=true`, an explicit `ASSISTANT_MODEL`, and separate opt-in
`ASSISTANT_TRACING_ENABLED=true`. Populate the `OpenAiAgentsSecretArn` output with a
real project key before the later readiness-attested activation; the generated
placeholder is not an inference credential. The key stays in Secrets Manager on
the web task. The TLS, approved-backup and migration/journal gates above still
apply. See [integration status](docs/integration-status.md) for verified evidence
and remaining live-configuration checks.

The deployment workflow also supports a `verify_only=true` manual dispatch to
exercise its complete reusable verification gate while explicitly disabling AWS
deployment and migrations, even if deployment credentials are configured.
