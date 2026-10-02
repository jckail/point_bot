# Native overhaul integration into PR #14

## Preserved branches

Native work is preserved in [PR #15](https://github.com/jckail/point_bot/pull/15),
branch `codex/pointup-overhaul-20261001`, release worktree
`/home/jkail/projects/point_bot-release`. Runtime commit `4303c05` passed
[all four CI jobs](https://github.com/jckail/point_bot/actions/runs/36969293365):
371 unit tests, 47 PostgreSQL cases, eight infrastructure contracts, lint,
workspace types, application bundles and CDK synthesis. Later commits only
update verification/handoff docs. The original native checkout remains intact.

The integration branch is `codex/pointup-integrate-20261001` in
`/home/jkail/projects/point_bot-integration`, based on refreshed PR #14 head
`e04725fd01df49ce02ac3e0b14f4da96640ded41`. It preserves PR #14's outbox,
optimizer, transfer bonuses, catalog, retention, cache, stricter types,
OpenTelemetry, readiness and Docker/dev flows. This is a staged integration,
not the final combined release or production deployment.

## First integration stage

- Explicit Authorization never falls back to Clerk cookies or a seeded dev
  session. Clerk JWTs require independent verification and matching session
  identity; browser-only operations reject every Authorization header.
- Cookie mutations require an Origin matching validated canonical `APP_URL` or
  direct Host with the expected scheme. Forwarded hosts grant no trust. PAT and
  independently verified Clerk bearer clients retain their credential authority.
  Production HTTP Docker sets `APP_URL=http://localhost:<WEB_PORT>`; TLS proxies
  can configure their public HTTPS origin explicitly.
- Worker, bootstrap and CLI migrations share bounded advisory locking before
  Drizzle journal reads, dedicated two-connection pools, TLS tuning and cleanup.
  Known transaction-mode pooler URLs fail before connecting. Migration connections
  require direct PostgreSQL or a session pooler; application transaction pooling
  remains supported. The existing migration history is unchanged.
- OpenTelemetry spans, status messages and structured Error logs retain fixed
  diagnostic categories and validated public error codes, omitting upstream
  names, messages, stacks and payloads. The legacy assistant returns a generic
  unavailable response. SDK tracing privacy remains a separate port.
- Test workspace scripts bound Vitest to two workers. The migration CLI is included
  in core TypeScript checks. Compose configuration parsed successfully locally.

Runtime commit `74ad309c1184231187a85abbe4aa6f3b1c660b62` passed all six jobs in
[CI run 36971599307](https://github.com/jckail/point_bot/actions/runs/36971599307)
and [CodeQL](https://github.com/jckail/point_bot/actions/runs/36971599374).
The fresh lockfile installation, root lint, hygiene, all workspace TypeScript,
504 workspace tests including real PostgreSQL integration, production web and
worker/bot/MCP/extension bundles, plugin/spec checks, infrastructure synthesis,
nine HTTP MCP smoke tests, and Docker smoke in both direct and transaction-pooler
modes passed. The three isolated migration-lock PostgreSQL tests passed, covering
concurrent journal reads, bounded contention and rollback/lock release. This
fixture evidence does not establish the production database's schema state.

Earlier focused auth/policy checks passed 46 tests, migration helper checks 13,
and privacy/assistant checks 19 on exact source with existing mirror binaries.
Two strict privacy-test fixture errors found by CI were corrected before the
successful aggregate run. Local `npm ci` through `agent-heavy-check` exited 75
before installation because another project held the resource lock. Do not retry
unchanged or claim local worktree dependencies were installed. Root owns broad
verification; the passing aggregate evidence comes from this branch's fresh CI.

## Security dependency port

The PR #14 tree's report-only production audit found six advisories (one critical,
four high, one moderate). The integration now ports the already validated native
Next/ESLint 16.3.8 and Nodemailer 10.0.13 manifests and exact registry lock entries,
including patched sharp 0.35.5, PostCSS 8.5.23, nanoid 3.3.19 and browser mapping
2.11.27. PR #14 feature dependencies and tsx 4.23.15 remain preserved. Static
resolution checks covered 321 dependency-closure nodes and 77 manifest/lock
requirements; no installation or fresh audit is claimed by those checks.
Fresh CI then verified installation, full types and builds, and its application
production audit reported **zero vulnerabilities**. This result covers the
current lockfile and observed advisory database, not future advisories.
The infrastructure bundled brace-expansion advisory and separate development
advisories are not resolved by these application patches.

## Remaining integration and runtime gates

Port the shared Agents SDK assistant, owner/process admission, safe tracing,
usage metrics and evaluations without replacing PR #14's HTTP telemetry/auth
wrapper or legacy assistant/optimizer composition. Adapt branded IDs and preserve
OpenTelemetry IDs separately from SDK trace IDs. Existing log redaction treats
keys containing `token` as secrets; token usage needs a narrowly tested metadata
adapter. PR #14's extension needs the native assistant chat surface. Proposal
storage, browser review, contracts and assistant tools must arrive together;
do not silently remove the native proposal capability or claim the full native
evaluation dataset passes during an intermediate read-only port.

Retain PR #14 migrations 0000–0015 and prepare additive integration migrations:
SIWC/proposals; tenant-qualified goal membership with quarantine; versioned
observation token/consent/idempotency provenance; staged safe numeric constraints.
Preserve historical observations without inventing missing provenance, existing
review IDs/outcomes, `account_tag`, the `agent` balance source, outbox events and
retention audit semantics. Inspect actual deployment journals/tables and preserve
a recoverable backup before selecting/applying adoption migrations. Neither source
branch proves what schema reached staging or production.

Production deployment is authorized but currently lacks GitHub deployment secrets
and valid local AWS authentication. Live Clerk/OpenAI/Chrome testing, exporter
and dashboard delivery, approved ChatGPT client/session bridging, hosted OAuth MCP,
provider partnerships, dependency advisories and remaining data atomicity/RLS
work remain part of the original goal. iOS is deferred as requested.

Agent Hub does not map these worktrees to a configured memory scope, so curated
repository documents carry the handoff. Shared Graphify lacks PointUp coverage;
use targeted current source and refresh the shared corpus after source edits.
Reuse one browser tab per agent session. Do not replace the shared graph, run
parallel expensive checks, or disturb unrelated agents' processes/worktrees.
