# PointUp overhaul: evidence and remaining gates

This is a working record for the ongoing overhaul, not a release announcement.
The repository inspected on 2026-10-01 is already TypeScript, Next.js, Drizzle and
PostgreSQL with a domain/use-case/adapter boundary. The supplied Claude handoff
mentions a later agent branch; those files were absent from this worktree when
this round began. Do not infer merged or deployed features from that handoff.

## Current implementation tracks

| Requirement | Current source | Verification gate |
| --- | --- | --- |
| Web experience | Landing/dashboard/navigation/account filtering and identity settings; see design.md | Build and rendered desktop/mobile/keyboard review; live Clerk-backed flows |
| Chrome extension | Guided 13-program chooser, click-only activeTab capture, scoped PATs, consent-bound idempotent observations and browser action review | Unit/background boundary tests, build, real unpacked Chrome smoke test |
| AI assistant agent | Shared authenticated TypeScript OpenAI Agents SDK runtime with persistent reviewed balance/goal proposals and ten synthetic evaluation scenarios | Tool/run/review and evaluation tests; live configured model run, semantic evaluation and tracing/export review |
| Observability | Request correlation, metadata-only SDK tracing, structured lifecycle logs and CDK CloudWatch metrics/dashboard/alarms | Inspect live trace export, log ingestion and alarm thresholds; operational notification actions remain |
| MCP and plugins | Local stdio and private Streamable HTTP MCP with per-request scoped PAT access and proposal-only mutations, Claude skill and ChatGPT Actions setup material | Focused transport isolation tests passed; hosted OAuth connector, publishing and full plugin package remain |
| Sign in with ChatGPT | Registered OIDC identity linking to an existing Clerk account | Managed migration + approved client + live roundtrip; independent sign-in/session bridge remains |
| Core/data integrity | Owner-bound tokens, atomic capture writes, migration 0009 tenant-qualified goal membership and canonical tags, transactional import/manual writes and explicit migration locking | 358 unit and 47 actual PostgreSQL tests passed in current-source CI; PR #14 reconciliation and production adoption remain |
| Provider integrations | Official capability catalog, six reviewed page-reader programs and guided manual fallback; aggregator/vault ports exist | Live reader verification and partnership APIs remain; no new partnership credential is provisioned here |
| Documentation | Feature-specific design/setup/audit docs and this evidence record | Reconcile historical roadmap claims against current source and live deployment |
| iOS | Deferred by user; shared API remains client boundary | Future project phase |

## Verified milestone

See [verification.md](verification.md): current-source CI passed 358 unit
tests and 47 real PostgreSQL checks, including all 15 normalization/transaction
cases. Root lint, workspace typechecks, application bundles and infrastructure
contracts/synthesis passed. [PR #15](https://github.com/jckail/point_bot/pull/15) preserves this work; PR #14 integration remains.
Production dependency audit reports zero findings. Live auth, provider and rendered
reviews remain unverified; the requirements below remain active.

## Next engineering gates

1. Keep combined checks green as the next capabilities land; preserve the exact
   verification scope and resolve the remaining development dependency advisories.
2. Exercise authenticated web and extension workflows against test PostgreSQL and Clerk.
   Include cross-account denial, capture chronology, imports and restored accounts.
3. Exercise durable scoped authorization, expiring account consent and immutable
   observations in authenticated web/extension flows. Source and PostgreSQL
   tests now enforce these boundaries; remote connector OAuth remains.
4. Exercise persistent assistant proposals with a live model and browser review.
   Server-bound IDs, expiry and duplicate-execution tests are implemented.
   Run the opt-in synthetic model evaluations, review their semantics and verify
   trace delivery for both surfaces. Deterministic evaluation fixtures are implemented.
5. Deploy the verified managed SIWC migration with a reviewed backup plan;
   then complete independent sign-in with a verified session strategy and
   approved OpenAI registration. Private-table PostgreSQL RLS tests pass.
6. Validate migration 0009 goal membership/tags, tenant-qualified foreign keys and
   atomic use-case transactions against the dedicated PostgreSQL fixture. Verify
   the migration-first ECS deployment gate; database rollback remains a separate
   operator procedure, not a CloudFormation rollback guarantee.
7. Validate vendor catalog/transfer routes with current primary sources; make
   freshness, permissions and integration status visible in product decisions.
8. Perform rendered UX/accessibility/security and dependency review; exercise
   retries, response uncertainty, provider failures and production configuration.
9. Package and test remote MCP/OAuth, ChatGPT plugin and Claude distribution.
   Publish/deploy only after these gates provide reviewable release evidence.

## Continuation checkpoint

The previous goal work produced verified source changes and automated evidence;
classify it as progress. Durable scoped authorization, account consent, reviewed assistant proposals
and guided browser collection are now implemented and under combined verification.
Next validate the implemented portfolio normalization and migration-first rollout,
exercise authenticated end-to-end flows and live telemetry, and complete remote
connector distribution. Complete independent SIWC sign-in/session integration
after approved registration. Do not mark the full overhaul complete.

## Workspace handling

The initial worktree has widespread LF/CRLF differences. Preserve unrelated
changes; inspect semantic diffs with `git diff --ignore-space-at-eol`.
Graphify's shared corpus query did not provide PointUp source coverage; this round
uses live source and runs the shared refresh without replacing the corpus.
