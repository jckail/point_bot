# Handoff prompt: resume PointUp work locally

Paste everything in the block below into a fresh Claude Code session started in a local clone of this repo, on branch `claude/charming-cannon-d6xxhc`.

````text
You are resuming work on PointUp (repo: jckail/point_bot), an agent-native loyalty
points manager. Branch: claude/charming-cannon-d6xxhc. Open draft PR:
https://github.com/jckail/point_bot/pull/14. Last known state: all 8 CI checks
green at commit 1456c0b.

## First, orient (do not skip)
1. `git fetch origin && git checkout claude/charming-cannon-d6xxhc && git pull`
2. Read, in order: docs/review.md (findings + status), docs/agents.md (agent
   surface + security model), docs/security-review.md, docs/architecture.md
   (incl. "Type system conventions"), docs/optimizer.md, docs/events.md,
   docs/observability.md, docs/performance.md, docs/local-development.md.
3. Run the stack: `npm install && npm run docker:up`, then `npm run docker:smoke`.
   Dev auth is on (AUTH_PROVIDER=dev): no Clerk or cloud accounts needed. The
   bootstrap job prints a dev token and connection snippets
   (`docker compose logs bootstrap`).
4. Verify the baseline before changing anything:
   `npm run typecheck && npm run lint && npm run hygiene`, then migrate and test:
   `DATABASE_URL=postgresql://postgres:password@localhost:5432/app npm run db:migrate`
   `TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/app npm test`
   `(cd e2e && npm test)`. Expect 0 type errors, clean lint, ~350 core tests.

## What exists (all merged on the branch)
- Hexagonal TS monorepo: packages/core (domain/application/infrastructure/
  composition), apps/web (Next 16), worker, bot, mcp, extension, plugins/claude,
  plugins/chatgpt, infra (AWS CDK), supabase/ (local config), deploy/observability.
- Agent bounded context: hashed scoped personal access tokens (pu_...), per-provider
  time-boxed consent (granting is SESSION-ONLY), declarative agent skills,
  SubmitObservation write-back (host allow-list, consent, plausibility holds that
  only a human can confirm via single-use review ids), append-only audit.
- MCP server (stdio + stateless HTTP), Claude plugin (skills/agent/commands),
  ChatGPT Action spec generated from zod contracts.
- Domain events + transactional outbox (worker claims with SKIP LOCKED),
  observability (redacting logger, OTel, Prometheus), rate limiting, retention
  purge job, read cache, ~190-program catalog, transfer graph, sweet spots,
  explainable integer-math redemption optimizer, branded ids, derived enums.
- Postgres via Drizzle (migrations 0000-0015); RLS on every table, no policies.

## Hard rules learned the hard way
- package-lock.json must keep the musl/arm64 optional entries for lightningcss and
  @tailwindcss/oxide. Check `grep -c lightningcss-linux-x64-musl package-lock.json`
  is >= 3 after ANY npm install; if lower, restore them (the Alpine Docker build
  fails without them). Prefer editing lock workspace entries by hand over `npm install`.
- Never push a state that fails typecheck/lint/tests; CI runs hygiene (no import
  cycles, <2% duplication), Postgres integration tests, the docker compose smoke
  test, CodeQL, plugin validation and e2e.
- Concurrent `next build` runs collide on apps/web/.next; stale .next/types cause
  phantom type errors: `rm -rf apps/web/.next` before typecheck.
- Never present catalog values as facts: confidence/lastReviewed fields exist for
  a reason; skills without a confidently known login host are omitted, not guessed.
- Do not weaken security invariants: consent grant is session-only; tokens never
  mint tokens; agents can never confirm held readings; user-reported transfer
  bonuses are visible only to their reporter until verified.

## Open items, in priority order (ask me which to start with)
1. VERIFY THE DATA: every catalog value (cents-per-point, expiry policy), sweet spot
   and skill start URL/host is an unverified editorial estimate, mostly low
   confidence. Verify against live official sources, set `verifiedAt` /
   `confidence` / `lastReviewed` only for what you actually confirmed, and fix
   wrong entries. Specifically check: the Alaska + Hawaiian merge into
   "Atmos Rewards" (alaska-atmos-rewards), Amex/Chase/Citi/Capital One/Bilt
   transfer ratios, and Air New Zealand Airpoints (dollar-denominated, currently
   valued at 60c/pt, which skews totals).
2. REAL AGENT RUN: exercise the browser/computer-use capture flow against a real
   provider page you are signed in to (consent in dashboard -> skill -> submit),
   and fix skill playbooks that don't match reality.
3. PRODUCT DECISIONS (ask me): (a) should a sync skip storing an unchanged
   balance snapshot? (changes what "change since previous reading" means);
   (b) rule for currency-denominated programs in totals; (c) a verification flow
   for user-reported transfer bonuses.
4. KUBERNETES + TERRAFORM (deliberately deferred): Helm chart for web/worker/mcp +
   migration job + HPA; Terraform for network, managed Postgres (RDS/Aurora or
   Supabase), cluster, secrets. Plan to freeze the CDK stack until cutover.
   Design notes: docs/local-development.md ("how this scales later"),
   docs/performance.md (capacity, PgBouncer, balance_snapshot partitioning plan,
   NOT implemented).
5. PRODUCTION GAPS: shared (Redis) rate limiter + cache adapters behind the existing
   ports; OAuth for ChatGPT/claude.ai connectors (PATs only today); instrument bot
   and worker; request ids in events; processed-outbox/dead-letter ops tooling;
   security findings S8-S13 status in docs/security-review.md; run the
   observability compose profile for real (only config-validated so far); test
   Clerk mode with real keys (only dev auth was exercised).
6. HYGIENE: add Prettier as ONE mechanical commit; clean unused exports (knip
   needs an entry-point config first); remove unused @fontsource deps (lockfile!).
7. Mark PR #14 ready for review once items you choose are done.

## How to work
- Small validated steps; commit only green states; update docs/review.md statuses.
- For large parallel work, split by non-overlapping file ownership and have one
  integrator run the full validation before every push.
- Report what was verified for real vs only statically.
````
