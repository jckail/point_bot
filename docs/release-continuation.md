# Release continuation: reconcile native work with PR #14

## Verified source state

Native work was committed and pushed as `326b2e5` on `codex/pointup-overhaul-20261001`, with [draft PR #15](https://github.com/jckail/point_bot/pull/15). All four jobs in [CI run 36966931868](https://github.com/jckail/point_bot/actions/runs/36966931868) passed: 358 unit tests, 47 PostgreSQL tests, application bundles, eight infrastructure contracts, typechecks and synthesis. PR #15 has not been merged or deployed. The local portfolio fixture is stopped, with its data retained.

A follow-up privacy/evaluation change sanitizes SDK response-span provider errors before export and checks actual evaluation tracing readiness. Focused SDK/privacy checks passed 15 tests, evaluations 18 tests (one live skip), web TypeScript and affected lint. The aggregate CI evidence above predates this follow-up; observe its own CI before release.

The active native repository is `/home/jkail/projects/point_bot`; its Linux validation mirror is `/tmp/pointup-verification`. Native HEAD and the inspected `origin/master` are `4ebba1f2b07895017f2ab9fe1a8a50b505ddaed0`, with substantial uncommitted overhaul work. PR [#14](https://github.com/jckail/point_bot/pull/14), branch `origin/claude/charming-cannon-d6xxhc`, was inspected at `e04725fd01df49ce02ac3e0b14f4da96640ded41`. These references must be refreshed before release integration; this document records the inspected state, not a completed merge or deployment.

PR #14 and native implement overlapping agent features independently. Preserve PR #14's contributions. Do not replace its tree with the native snapshot or merge their migration histories blindly.

## Schema incompatibilities confirmed in source

The histories share migrations through 0007, then diverge:

- PR #14 `0008_agent_context.sql` creates `access_token`, `consent_grant`, and `agent_observation` with an ID primary key and `outcome`/`observed_at`. Native `0008_agents_and_proposals.sql` creates `agent_token`, `observation_consent`, and observations with `(user_id, id)` identity, token/consent foreign keys, `status`, `captured_at`, and `payload_hash`, plus proposal and managed SIWC storage.
- PR #14 `0010_normalize_tags_goal_accounts.sql` creates `account_tag` and `trip_goal_account(account_id)`, then drops legacy `tags` and `account_ids`. Native `0009_portfolio_integrity.sql` uses canonical tag arrays and tenant-qualified `trip_goal_account(loyalty_account_id, user_id)`, retains legacy columns, and synchronizes their writes with triggers.
- PR #14 retention deletes expired tokens/consents while preserving observation audit. With native foreign keys, deleting referenced tokens is blocked and deleting consents cascades into observations. Its retention adapter cannot be ported merely by renaming tables.

Choose one coherent migration history and matching repository contracts. If either alternative history has reached a real database, inspect its journal and data before preparing an explicit adoption migration; source comparison alone does not establish deployed schema state.

## Valuable PR #14 work absent from native

Preserve its transactional event outbox, retention worker, redemption optimizer, broader catalog, transfer bonuses, read cache, rate limiter, observability, readiness endpoints, development auth/bootstrap, Docker MCP stack and smoke checks, branded IDs, derived enum helpers, stricter TypeScript/typed lint, and Supabase/pooler connection tuning. Native `createDb` lacks PR #14's Supabase TLS and transaction-pooler prepared-statement settings.

PR #14's Docker smoke assumes its dev/bootstrap stack, readiness routes, provider-level consent API and MCP tool names. Native compose/API cannot satisfy those assumptions unchanged. PR #14 integration tests use `TEST_DATABASE_URL` with a migrated database; native dedicated suites use guarded loopback fixtures, and portfolio requires an empty database before legacy data is staged.

## Ordered integration plan

1. Preserve native work on `codex/pointup-overhaul-20261001` in `/home/jkail/projects/point_bot-release`, based on shared master `4ebba1f`. This preservation branch is not the integrated release. Then integrate in a separate worktree based on PR #14, reviewing remote changes before choosing individual ports. Root owns release integration, commits, pushes, deployment and broad verification.
2. Resolve the schema/API contracts first. Keep one journal, reconcile token lifetimes/scopes, consent granularity, observation identity/review behavior, and decide how native SIWC/proposal storage joins that history.
3. Port native security/correctness improvements into PR #14's existing composition: tenant constraints, replay/expiry locking, atomic mutations and bounded migration serialization. PR #14's worker migration comment incorrectly assumes the installed Drizzle migrator takes an advisory lock; preserve native `migrateWithLock` behavior. Migration session locks require a direct/session connection, not transaction pooling.
4. Retain PR #14 features and type conventions while adapting native additions. Reconcile retention with the intended audit policy before enabling it against revised tables.
5. Combine CI checks using separate fresh databases where required. Preserve PR #14's integration/Docker coverage and native portfolio's pre-0009 fixture. Validate the integrated source once through the resource wrapper; do not reuse earlier branch results as evidence for the merge.
6. Commit and push the reviewed integrated result, verify its remote checks, then perform the authorized deployment when credentials/configuration permit it. Record the final commit, migration outcome and post-deployment checks.

## Evidence and release boundaries

- Historical native combined workspace run: **303 unit tests passed** (bot 20, extension 44, MCP 9, web 60, API client 20, core 150). It predates current design/evaluation/remote-MCP/0009 changes; see [verification.md](verification.md).
- Latest native root lint and all seven workspace TypeScript checks passed on the exact-source Linux mirror. Focused admission/HTTP checks passed 17 tests, core contracts 21, SDK/usage 12, extension background 24, observability templates 4 and provider capabilities 9. These focused checks are not a new aggregate build/suite result.
- Historical/latest recorded native PostgreSQL expiry pass: **32 passed** (24 agent, 8 baseline). It does not establish current portfolio migration success; see [database-verification.md](database-verification.md).
- Current portfolio suite passed **15 actual PostgreSQL tests** in its own fresh CI fixture. Earlier local attempts were blocked by shared heavy-check contention; that evidence remains preserved.
- PR #14 was reported to have passing CI at its current branch state; that does not establish compatibility with native ports or an integrated release.
- New reusable `.github/workflows/postgres.yml` is called by CI and deploy, and deployment depends on its result. All three YAML files parsed and structural assertions passed; this workflow **passed both fresh-fixture matrix jobs** at `326b2e5`.

The user authorized committing, pushing and deploying all work. Authorization persists; missing configuration is an operational blocker, not a reason to request the same permission again. At this checkpoint, repository deployment secrets were unavailable and local AWS credentials were expired. Do not claim a release, deployment or new CI result until observed. Root owns broad checks and release mutations; delegated work must retain explicit file ownership.

Use only **one browser tab** during browser verification, as requested by the user. Follow repository resource limits: expensive local checks run through `/home/jkail/.local/bin/agent-heavy-check`, with one verification owner. Refresh the shared Graphify corpus after final source edits. Save only curated project facts in continuity checkpoints; exclude credentials, private configuration, transcripts and investigation material.
