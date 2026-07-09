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
| CI             | GitHub Actions (lint, typecheck, test, build, CDK synth)                                |

## Documentation

- [docs/roadmap.md](./docs/roadmap.md) — feature roadmap: what's shipped, what's next, and how it's sequenced
- [docs/api.md](./docs/api.md) — full API v1 reference with request/response examples
- [docs/architecture.md](./docs/architecture.md) — DDD layering, SOLID mapping, workspace layout
- [docs/multi-surface.md](./docs/multi-surface.md) — adding mobile apps and browser extensions
- [docs/integrations.md](./docs/integrations.md) — loyalty providers (airlines, hotels, credit cards, rail, shopping) and credential vaults (1Password, Apple Keychain, Chrome)
- [docs/brand.md](./docs/brand.md) — brand kit: logo assets, color tokens, typography, voice
- [docs/migration-from-pointup.md](./docs/migration-from-pointup.md) — how the modernization was ported into `point_bot`, feature-parity checklist, and the Bedrock assistant

## Repository layout

```
├── apps/
│   ├── web/                  # Next.js app: pages, components, API routes, composition root
│   │   ├── src/components/   #   branded UI components (logo, cards, forms)
│   │   └── public/brand/     #   brand kit assets (SVG logomarks, lockup)
│   └── worker/               # Background jobs: scheduled syncs + email digests
├── packages/
│   ├── core/                 # Domain + application + infrastructure (framework-free)
│   │   ├── src/domain/       #   entities, provider catalog, repository ports, errors
│   │   ├── src/application/  #   use cases + outbound ports (gateway, vault, clock)
│   │   ├── src/contracts/    #   zod wire schemas shared by all surfaces
│   │   ├── src/infrastructure/  # Drizzle repos, provider gateways, vault adapters
│   │   └── drizzle/          #   generated SQL migrations
│   └── api-client/           # Typed HTTP client for mobile / extension surfaces
├── infra/                    # AWS CDK app (standalone package)
└── docs/                     # Architecture and integration guides
```

## Local development

Requirements: Node.js ≥ 20 and Docker (for the local database).

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment
cp .env-example .env
# Fill in your Clerk keys from https://dashboard.clerk.com (API keys)

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

All infrastructure is defined with the AWS CDK in [`infra/`](./infra):

- **VPC** with public, private (egress) and isolated subnets across two AZs
- **RDS PostgreSQL 17** in isolated subnets, credentials auto-generated in Secrets Manager, storage encryption, 7-day backups, deletion protection
- **ECS Fargate** service (2+ tasks, CPU-based autoscaling to 6) behind a public **Application Load Balancer** with `/api/health` health checks and deployment circuit breaker
- **Docker image** built from the repository `Dockerfile` (monorepo-aware, standalone Next.js output) at deploy time and pushed to a CDK-managed ECR repository
- **Secrets Manager** secret for the Clerk secret key (placeholder — set the real value after the first deploy); the Clerk publishable key is passed as a Docker build arg since it is inlined into the client bundle
- **Scheduled worker tasks** (EventBridge → Fargate, from `Dockerfile.worker`): balance syncs every 6 hours and a weekly digest email job on Mondays
- **SES** for digest delivery — verify a sender identity, then deploy with `-c digestFromEmail=digest@yourdomain.com` (without it the digest job logs instead of sending)
- **CloudWatch alarms** on ALB 5xx responses and sustained service CPU

```bash
cd infra
npm install

# One-time per account/region
npx cdk bootstrap

# Deploy (builds and pushes the Docker image, then updates the stack)
npx cdk deploy
```

After the first deploy:

1. Set the real Clerk secret key in the secret printed as `ClerkSecretArn`:

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id <ClerkSecretArn> --secret-string 'sk_live_...'
   ```

2. Deploy with your real Clerk publishable key so it is baked into the client bundle:

   ```bash
   npx cdk deploy -c clerkPublishableKey=pk_live_...
   ```

3. Run the database migrations against RDS (e.g. from a bastion host or an ECS one-off task):

   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   ```

4. Add `http://<LoadBalancerUrl>` (or your domain) to the allowed origins in the Clerk dashboard.

5. To enable digest emails, [verify a sender identity in SES](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) (and move out of the SES sandbox for real recipients), then redeploy with:

   ```bash
   npx cdk deploy -c clerkPublishableKey=pk_live_... -c digestFromEmail=digest@yourdomain.com
   ```

For production, add an ACM certificate and a Route 53 hosted zone to `ApplicationLoadBalancedFargateService` in `infra/lib/app-stack.ts` to enable HTTPS, and consider enabling `multiAz` on the database plus a second NAT gateway.

### Continuous deployment

Every push to `master` deploys automatically via [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml): full verification (lint, typecheck, tests, builds) → `cdk deploy` (builds and pushes both Docker images, updates the stack) → database migrations as a one-off Fargate task (the worker image's `migrate` job, which applies pending drizzle migrations under an advisory lock so concurrent runs serialize).

Authentication uses GitHub OIDC federation — no long-lived AWS keys are stored in the repository. One-time setup:

```bash
# 1. Create the OIDC provider + deploy role (in infra/)
npx cdk deploy GithubOidc -c githubRepo=<owner>/<repo>

# 2. In GitHub repo settings, add:
#    Secret   AWS_DEPLOY_ROLE_ARN   = DeployRoleArn output from step 1
#    Secret   CLERK_PUBLISHABLE_KEY = pk_live_... (inlined into the client bundle)
#    Variable AWS_REGION            = deployment region (optional, default us-east-1)
#    Variable DIGEST_FROM_EMAIL     = verified SES sender (optional)
```

The deploy role's permissions are minimal: it can only assume the CDK bootstrap roles and run the migration task. Until `AWS_DEPLOY_ROLE_ARN` is configured, the workflow verifies the build and skips deployment. Pull requests run the [CI workflow](./.github/workflows/ci.yml) (checks only, no AWS access).

## Running the full stack in Docker locally

```bash
docker compose --profile app up --build
```

This starts PostgreSQL and the production image of the app on [http://localhost:3000](http://localhost:3000).
