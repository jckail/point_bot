# Codebase review (October 2026)

Scope: whole repository at `4ebba1f`. Baseline: lint clean, typecheck clean, 141
tests green before changes.

## What is already strong (kept)

- Hexagonal core with ports, in-memory fakes, and thin controllers; no framework imports in `@pointup/core`.
- Zod contracts as the single wire source of truth; OpenAPI generated from them.
- Drizzle + SQL migrations in version control; CDK infra; CI.

So the "overhaul" is **not** a rewrite to DDD/TypeScript/ORM: those already exist.
It adds an agent bounded context and hardens the seams below.

## Findings and status

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | No non-browser auth: MCP/ChatGPT/scripts had only Clerk cookies/tokens | High (blocker for agents) | **Fixed** – scoped, hashed PATs; `withAuthenticatedUser` now takes a required scope |
| 2 | Agent/browser captures indistinguishable from manual entry; no consent or audit | High | **Fixed** – `source: "agent"`, consent grants, observation audit trail |
| 3 | Tables exposed to Supabase REST if hosted there | High (on Supabase) | **Fixed** – migration 0009 enables RLS |
| 4 | `postgres.js` prepared statements break on pgbouncer/Supabase pooler; no TLS handling | Medium | **Fixed** – `postgresOptionsFor` |
| 5 | OpenAPI drift: `GET …/balances` undocumented; `POST …/balances` documented as returning an account (returns a balance) | Medium | **Fixed** |
| 6 | `container.ts` is a 270-line manual wiring file duplicated in `apps/bot` and `apps/worker` | Medium | **Fixed** – per-context composition modules in `packages/core/src/composition`; web/bot/worker containers are thin |
| 7 | `tags` and `trip_goal.account_ids` are comma-separated strings | Medium | **Fixed** – `account_tag` / `trip_goal_account` join tables, data-migrating SQL (0010), RLS (0011) |
| 8 | Text ids (`varchar(255)`) instead of `uuid`; no FK from `agent_observation`/`activity_event` to accounts | Low | **Partly fixed** – FKs added (`activity_event`, `agent_observation`); ids intentionally stay `varchar` |
| 9 | No rate limiting on any route | Medium | **Fixed** – per-principal sliding-window limiter, 429 + `Retry-After`; in-memory per instance (swap adapter for multi-instance) |
| 10 | Pre-existing: `next build` needs network for Google Fonts | Low | **Fixed** – fonts self-hosted via `next/font/local` |
| 11 | Provider hosts/start URLs in skills are best-effort and will rot | Low | Documented; skills are data and versioned (`version`) |

## Verification performed

- `tsc` on every workspace, `eslint .`, `vitest` (unit) – green.
- Drizzle migrations 0000–0009 applied to a real Postgres 16; RLS confirmed (`relrowsecurity = t`).
- Integration test (`TEST_DATABASE_URL`) exercises tokens → consent → write-back → audit on Postgres.
- MCP server tested end-to-end through the SDK's in-memory transport, including elicitation accept/decline.
- **Not verified here:** `next build` (blocked by Google Fonts fetch, finding 10) and a live browser-agent run against a real provider site.
