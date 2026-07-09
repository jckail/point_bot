# Migration: from the `pointup` modernization into `point_bot`

This document records how the loyalty-points product modernization — built on
the `jckail/pointup` branch `cursor/modernize-ts-drizzle-aws-0b0a` (PR #1) — was
ported into `point_bot`, which is its intended home.

## Background

`point_bot` and `pointup` are the **same product** (loyalty-points aggregation)
in **two different stacks**:

| | `point_bot` (before) | `pointup` (work branch) |
| --- | --- | --- |
| Stack | Python 3.8, Selenium / undetected-chromedriver | TypeScript monorepo (Next.js 16, Drizzle/Postgres, AWS CDK) |
| What it was | Real headless scrapers for Marriott, Southwest, United, Hyatt, Delta, American, MGM, Frontier | Full DDD / hexagonal modernization with the complete feature set |
| Auth | Auth0 + S3-encrypted passwords | Clerk |
| Infra | EC2 + NordVPN evasion | ECS Fargate, ALB, RDS, Secrets Manager (CDK) |
| Assistant | none | OpenAI-compatible + heuristic fallback (Bedrock was the next step) |
| Status | "long discontinued" | 25 commits of active modernization |
| Brand | "PointBot" | "PointUp" |

The two share the product concept but nothing at the code level (different
languages). So this was **not** a module-by-module integration — the modernized
monorepo became the primary application, while `point_bot`'s identity and its
real scraper logic were preserved.

## Decisions

1. **Branding — keep "PointUp".** The working PointUp brand strings and
   `@pointup/*` package names are retained as-is. `point_bot` is treated as the
   same product under a different repository name; a wholesale rename would be
   pure churn with no product benefit.
2. **Legacy Python — preserved, not deleted.** The original Selenium scrapers
   moved to [`legacy/python-selenium/`](../legacy/python-selenium/). They are
   not built or deployed, but they are the real per-provider login/extraction
   logic and are the reference for a future real `TravelProviderGateway`
   adapter. See that folder's README.
3. **Scope — full parity + Bedrock.** The entire monorepo was imported (core,
   web, worker, api-client, infra, docs, tests) and the previously-unfinished
   AWS Bedrock assistant was implemented and wired.

## What was ported (feature parity)

All of the modernized capability set now lives in `point_bot`:

- [x] Core domain + Drizzle schema + migrations `0000–0004`
- [x] Clerk auth composition root
- [x] Loyalty CRUD, sync (simulated gateway), editorial valuations, trends
- [x] Export/import (CSV/JSON), activity feed, expirations, iCal
   (`/api/v1/calendar.ics`)
- [x] Trip goals, notes/tags/pins, 7-day soft-delete undo, demo seed, public
   share links
- [x] Background worker: scheduled syncs + SES weekly digests
- [x] Transfer-partner graph + bang-for-buck value advice + deal scrape ingest
   (Firecrawl or stub)
- [x] Assistant chat UI/API (`/api/v1/assistant/chat`)
- [x] Infra CI/CD (GitHub Actions + AWS CDK)
- [x] Docs (`docs/`)

## What was added here: AWS Bedrock (Claude Sonnet)

The one item explicitly *not* done in `pointup` — production Bedrock Claude as
the `LlmAssistant` — is implemented in this port:

- **Adapter:** `packages/core/src/infrastructure/llm/bedrock-assistant.ts`
  (`BedrockAssistant`) implements the `LlmAssistant` port using the
  provider-neutral **Converse API** from `@aws-sdk/client-bedrock-runtime`. It
  maps the port's `{ system, messages }` to Converse (`system` blocks +
  alternating `user`/`assistant` turns), lazily loads the AWS SDK only when
  selected, and injects a client for unit testing
  (`packages/core/test/bedrock-assistant.test.ts`).
- **Selection:** the web composition root (`apps/web/src/server/container.ts`,
  `buildLlm`) chooses Bedrock when `LLM_PROVIDER=bedrock` and `BEDROCK_MODEL_ID`
  are set, then the OpenAI-compatible path if `LLM_API_KEY` is present, else the
  deterministic `HeuristicAssistant` (local/dev/tests). No API keys in AWS.
- **Config:** `LLM_PROVIDER`, `BEDROCK_MODEL_ID`, `AWS_REGION` added to
  `apps/web/src/env.ts` and `.env-example`.
- **Infra:** `infra/lib/app-stack.ts` grants the web task role
  `bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` on
  foundation-model + inference-profile ARNs and injects `LLM_PROVIDER` /
  `BEDROCK_MODEL_ID` into the task env when a model id is provided via
  `-c bedrockModelId=...`.

> **Verify the model id in-account.** `BEDROCK_MODEL_ID` is region-/profile-
> prefixed and the exact latest Sonnet id varies by account/region. The default
> example is `global.anthropic.claude-sonnet-4-5-20250929-v1:0`; confirm the
> current Sonnet inference-profile id with
> `aws bedrock list-inference-profiles` (or `list-foundation-models`) before
> deploy, and enable model access in the Bedrock console.

## Running locally

```bash
npm install
cp .env-example .env          # fill in Clerk keys
docker compose up -d db
npm run db:migrate
npm run dev
```

The assistant runs on the heuristic fallback with no extra config. To exercise
Bedrock locally, set `LLM_PROVIDER=bedrock`, `BEDROCK_MODEL_ID`, and provide AWS
credentials via the standard chain.

## Follow-ups / next steps

- Verify Bedrock inference-profile id and enable model access in the target
  account; smoke-test the assistant end-to-end post-deploy.
- Wire real `FIRECRAWL_*` secrets into the CDK task env / Secrets Manager for
  live deal scraping (currently stubbed).
- Port real per-provider scraping from `legacy/python-selenium/` behind
  `TravelProviderGateway` to replace `SimulatedTravelProviderGateway`.
- Close/annotate `pointup` PR #1 pointing at the `point_bot` PR.
