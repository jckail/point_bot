# Performance

Measure first, then change. This page holds the benchmark harness, the numbers
before and after the changes made with it, the bottleneck analysis, an honest
Go-or-not verdict, and capacity guidance for growth.

> **Hardware caveat.** Everything below was measured in a shared 4-vCPU / 16 GB
> sandbox VM (Node 22, Postgres 16 on the same host, load generator on the same
> host, so client, server and database compete for the same cores). Numbers are
> **indicative**: use them for ratios and for locating bottlenecks, not as
> production capacity. Run-to-run noise on RPS is roughly +-15%. Anything marked
> *estimate* is arithmetic on those numbers, not a measurement.

## TL;DR

| Finding | Evidence | Action |
| --- | --- | --- |
| The accounts read shipped **every balance snapshot** of every account (3,875 rows for the heaviest seeded user) to Node and reduced it there. | Query was ~1 ms in Postgres but 11-15 ms end to end; HTTP 64-89 RPS. | Replaced with 4 index probes per account (<= 100 rows). **~3x** faster use case, **2.5-4x** HTTP RPS. |
| The same accounts list was recomputed for summary, expiring, advice, digest and 3-4 times per dashboard render. | Dashboard issues `listLoyaltyAccounts`, `listExpiringAccounts`, `getValueAdvice`, ... for one user. | Per-user read cache, 10 s TTL + write-through invalidation. |
| `/api/v1/providers` and `/dashboard` returned **500** (`providers.map is not a function`). | Found while load testing: `tracedAll` makes every `execute` async but two callers used the sync result. | Fixed (`await`). Pre-existing bug on `HEAD`. |
| After the data path is fixed, the remaining per-request cost is framework, tracing, JSON logging and GC. | CPU profile (section 4). | No domain hot spot left; JSON request logging alone costs up to ~25% of cached-route throughput. |
| The MCP HTTP server spent ~55% of its CPU rebuilding zod schemas per request (stateless server per request). | MCP profile (section 4). | **Fixed**: tool definitions and schemas are built once at module load; per request only the cheap handler binding remains. **2.8-3.1x** RPS in isolation (section 10). |
| No CPU-bound hot path that TypeScript cannot meet was found. | Sections 4 and 8. | **No Go rewrite.** |

## 1. Harness (`scripts/bench/`)

Everything runs against a scratch database named `app_bench` (the scripts
refuse any database whose name does not contain `bench`). Nothing here touches
migrations or the `app` database.

```bash
export PGPASSWORD=password
psql -h localhost -U postgres -c "create database app_bench"
DATABASE_URL=postgresql://postgres:password@localhost:5432/app_bench npm run db:migrate

# seed: N users, each 5-25 accounts x 50-200 snapshots (default 2,000; max 100,000)
npm run bench:seed -- --users=2000 --reset
```

2,000 users seed in ~56 s into: 29,970 accounts, **3,744,463 snapshots**
(733 MB incl. indexes), 80,000 activity events, 24,000 outbox rows, 2,000 hashed
tokens (plaintext `pu_bench_token_<i>`), 6,000 consents. Row counts scale
linearly; at ~0.2 KB/snapshot, 100k users is ~37 GB, more than this sandbox has
free, so the sandbox numbers stop at 2,000 users.

| Script | What it measures |
| --- | --- |
| `bench:queries` (`queries.ts`) | Runs the real repositories/use cases, captures **every SQL statement** via the Drizzle logger, times the call end to end (p50/p95) and runs `EXPLAIN (ANALYZE, BUFFERS)` on each captured statement. Heaviest and median seeded user. |
| `bench:web` (`web-bench.sh` + `http.ts`) | Starts the built standalone Next app (dev auth, scratch DB), loads it with autocannon over bearer tokens rotating across `USERS` principals (the per-principal rate limiter is 120 req/min, so one token would measure the limiter), prints RPS and p50/p97.5/p99/max, optional V8 CPU profile (`PROFILE=1`). |
| `bench:mcp` (`mcp-bench.sh`) | Same for the MCP HTTP transport (`tools/call` through to the web API), profiling the MCP process. |
| `bench:mcp-inproc` (`mcp-inproc.ts`) | MCP HTTP transport + tool dispatch against an instant stub upstream: the MCP server's own cost, no web app or database (section 10.1). |
| `bench:fanout` (`sync-fanout.ts`) | Real `SyncAllLoyaltyAccounts` + real repositories/outbox with a gateway that sleeps `--latency` ms: wall time vs fan-out. |
| `profile-summary.mjs` | Self-time by area and top functions from a `.cpuprofile`. |
| `proposed-indexes.sql` | Index proposals, applied **only** to `app_bench` to measure them. |

Reproduce the numbers on this page:

```bash
npm run bench:queries -- --iterations=60
(cd apps/web && SKIP_ENV_VALIDATION=1 npx next build)       # then: rm -rf apps/web/.next
cp -r apps/web/.next/standalone /tmp/sa-after                # keep a copy: other builds delete .next
SERVER_DIR=/tmp/sa-after PROFILE=1 OUT_DIR=/tmp/pb npm run bench:web -- after            # wide: 1500 tokens
SERVER_DIR=/tmp/sa-after USERS=300 ROUTES=summary,accounts,expiring,activity \
  npm run bench:web -- hot                                                               # hot: 300 tokens
SERVER_DIR=/tmp/sa-after PROFILE=1 npm run bench:mcp -- mcp
npm run bench:fanout -- --users=12 --latency=40
```

"Before" numbers were taken by building the same tree with the original
`drizzle-loyalty-account-repository.ts` restored and `READ_CACHE_TTL_MS=0`.

Two scenarios because a cache only helps if keys repeat:

- **wide**: 1,500 rotating principals, ~1-2 requests each per run. Cache hit
  rate is low; this isolates the query/serialization work.
- **hot**: 300 principals polling repeatedly (~90% hit rate at 10 s TTL), like
  a dashboard or MCP client that refreshes.

## 2. Query-level results (`bench:queries`)

Use case end to end (Node + driver + Drizzle + Postgres, one process), ms, p50.

| Read | User | Before | After | Statements |
| --- | --- | ---: | ---: | --- |
| accounts list (+ latest + trend + valuations) | heaviest (25 accts, 3,875 snapshots) | 15.0 | 4.3 | 3 -> 3 |
| portfolio summary | heaviest | 12.5 | 4.4 | 3 -> 3 |
| expiring accounts | heaviest | 11.0 | 4.1 | 3 -> 3 |
| accounts list | median (15 accts, ~1,455 snapshots) | 7.9 | 3.5 | |
| portfolio summary | median | 6.2 | 3.6 | |
| activity feed (limit 50) | heaviest | 1.1 | 1.1 | 1 |
| token authentication by hash | any | 0.7-1.2 | 0.7-1.0 | 1 (unique index) |
| consent lookup | any | 0.4-0.7 | 0.3-0.6 | 1 |
| outbox claim (limit 50) | n/a | 4.8 | 4.2 | 1 (see DDL, section 5) |

`EXPLAIN (ANALYZE, BUFFERS)` on the old trend statement: 3,875 rows read and
sorted, 165 buffer hits, ~1.3 ms in Postgres, but the **rows are the cost**: the
driver parses them, Drizzle maps them to objects, and `buildTrendContext`
walks them, all on the single Node thread (11 ms of CPU for ~1 ms of database
work). New statement: `unnest(account ids)` cross-joined `LATERAL` to four
`ORDER BY captured_at DESC, id DESC LIMIT 1` probes (latest, previous via
`OFFSET 1`, newest at-or-before 30 d, newest at-or-before 90 d), all served by
`balance_snapshot_account_captured_idx`: 100 rows, 401 buffer hits, ~0.7-1.0 ms.
Result size no longer grows with history length, which is what matters as users
accumulate 4 snapshots/account/day.

Everything else was already index-served (`activity_event_user_occurred_idx`,
`access_token_hash_unique`, `consent_grant_user_id_idx`,
`loyalty_account_user_provider_unique`). Checked the activity feed with 100k
events for one user: still an index scan backward, 0.3 ms.

## 3. HTTP results (`bench:web`, autocannon, 32 connections, 8 s/route)

Bearer-token principals, dev-auth build, JSON request logging **on**, requests/s
and latency in ms.

### wide (1,500 principals)

| Route | RPS before | RPS after | p50 before | p50 after | p99 before | p99 after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /api/v1/summary` | 64 | 164 | 472 | 188 | 776 | 366 |
| `GET /api/v1/loyalty-accounts` | 67 | 249 | 444 | 116 | 756 | 210 |
| `GET /api/v1/expiring` | 72 | 276 | 424 | 100 | 822 | 209 |
| `GET /api/v1/activity` | 228 | 302 | 131 | 101 | 435 | 209 |
| `GET /api/v1/providers` | 504 (was 500s on `HEAD`) | 542 | 61 | 55 | 110 | 140 |
| `GET /api/health` | 608 | 674 | 49 | 44 | 101 | 93 |

### hot (300 principals polling)

| Route | RPS before | RPS after | + auth cache | + `LOG_LEVEL=warn` too |
| --- | ---: | ---: | ---: | ---: |
| summary | 85 | 260 | 249 | 341 |
| accounts | 95 | 294 | 324 | 381 |
| expiring | 102 | 320 | 431 | 431 |
| activity | 288 | 274 | 342 | 337 |

"after" = default config (read cache on, 10 s TTL, auth cache off). The
auth cache is opt-in (`AUTH_CACHE_TTL_MS=5000`); it helps RPS but with worse tail
latency in this noisy box, and carries a revocation trade-off (section 6), so it
stays off by default.

Reading the table: `health` (no auth, no DB) tops out at ~650 RPS, about
1.5 ms of CPU per request: that is the floor of Next + our observability wrapper
on one Node thread. A cached read still pays auth lookup + rate limit + settings
+ serialization on top of it (2.5-4 ms). Once the data path is cheap, the
ceiling is per-request framework overhead (section 4), and the way up is more
instances, not more cleverness in the domain.

`JSON.stringify` of the account list (25 accounts) is a small part of the
profile; `ETag`/`If-None-Match` on `summary` and `loyalty-accounts` therefore
saves bandwidth and client parse time (304 with no body), not server CPU.

## 4. Where the time goes (CPU profiles, `node --cpu-prof`)

Web app, `GET /api/v1/summary` only, self time as % of busy time
(`profile-summary.mjs`):

| | Before (old SQL, no cache) | After (hot, quiet logs) |
| --- | ---: | ---: |
| Garbage collector | 15.6% | 6.7% |
| Next.js runtime + route pipeline (`pkg:next`, node internals) | ~31% | ~53% |
| App bundle incl. bundled drivers (postgres.js row parser, Drizzle mapping, our code) | 31.8% | 21.9% |
| Native (socket/stdout `writeBuffer`, `utf8Slice`, ...) | 20.4% | 16.8% |

Top self-time before: GC 15.6%, `writeBuffer` 13.4% (response bytes and one
JSON log line per request to stdout), postgres.js data-row parser 5.7%,
Drizzle row mapping 4.6% + 3.2%, `Date` construction from `date.js` 3.8%
(timestamptz parsing for the 3,875 rows), `findTrendContextByAccountIds` 1.3%.
After: GC 6.7%, `writeBuffer` 6.2%, microtask scheduling 4.8%, then a long flat
tail (Next request handling, AsyncLocalStorage propagation for tracing, URL and
header handling). No function of ours exceeds ~1%.

Conclusions:

1. The old hot spot was **row volume** (parse + map + reduce ~4k rows per
   request), pure waste, fixed in SQL, not a TypeScript speed limit.
2. What remains is framework and I/O overhead. Two knobs matter: JSON access
   logging on stdout (`LOG_LEVEL=warn` raised cached-route RPS by 18-37% in the
   hot run; for production, sample 2xx request logs and keep metrics) and
   tracing wrappers (AsyncLocalStorage `promiseInitHook`/`_propagate` ~2%).
3. MCP HTTP server (`bench:mcp`, 16 connections): 146-160 RPS, p50 88-97 ms.
   Its profile: **31% zod, 25% GC, 10% MCP SDK**. `createPointUpMcpServer`
   builds a new `McpServer` and ~20 zod tool schemas for **every request** (the
   server is stateless by design). Hoisting the schema/tool definitions to module
   scope (build once, bind the per-request client in the handler) removes most of
   that, a TypeScript fix. **Done in the follow-up, see section 10.**

## 5. What changed

| Area | Change |
| --- | --- |
| `infrastructure/repositories/drizzle-loyalty-account-repository.ts` | `findTrendContextByAccountIds` and `findLatestByAccountIds` use LATERAL index probes (<= 4 rows/account) instead of loading full history / `DISTINCT ON` over it. Timestamps are rendered as ISO strings in SQL so parsing does not depend on driver date parsers. Integration test `perf-queries.integration.test.ts` proves equality with the reference reduction `buildTrendContext` (ties, no-history, 30/90-day boundaries). |
| `application/cache.ts` (+ `test/cache.test.ts`) | `Cache` port and `InMemoryCache` (TTL + LRU + tag invalidation + single-flight `remember`; a load that started before an invalidation is never stored, so a read after a write sees the write). `noCache` double. Exported from `@pointup/core`. |
| `ListLoyaltyAccounts`, `BuildDisplayValue` | Optional read-through cache (constructor params appended; public signatures unchanged). Summary, expiring, advice, digest, public share and dashboard all derive from the cached accounts list. |
| `apps/web/src/server/read-cache.ts` | Process cache, `invalidateOnWrite` (every use case not named `list*/get*/build*/plan*/authenticate*/chat*/ingest*` invalidates the caller's `user:<id>` tag when it settles, also on failure; new use cases are safe by default), opt-in `cacheAuthentication`. |
| `apps/web/src/server/conditional.ts` | `ETag` + `If-None-Match` -> 304 on `summary` and `loyalty-accounts` (`private, no-cache`). |
| `domain/loyalty/provider.ts`, `domain/agent/skill.ts` | `findProvider` / `findSkill` use a prebuilt `Map` (first definition wins, as `find` did) instead of scanning the ~190-entry catalog per call (called once per account per read). |
| `infrastructure/db/client.ts` | `createDb(url, { max, idleTimeoutSeconds, connectTimeoutSeconds })`; defaults: max 10, idle 30 s (postgres.js never closes idle connections), connect timeout 10 s (was 30). Web reads `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_SECONDS`. |
| `SyncAllLoyaltyAccounts` | Bounded concurrency per user (default 4, ctor arg), outcomes keep account order, non-domain error still aborts. Worker `sync-all-users.ts`: `SYNC_USER_CONCURRENCY` (default 1 = unchanged). |
| `ExportPortfolio` | Per-account history reads issued together instead of sequentially (was one round trip per account). |
| `/api/v1/providers`, `/dashboard` | `await` the (async-wrapped) `listProviders.execute()`: both returned 500 on `HEAD`. |
| `packages/core/test/perf.test.ts` | CI guard: catalog lookup O(1) (ratio last/first id), 60-account summary computation, trend reduction, cache hit path. Generous absolute budgets (~50-100x typical) plus same-process ratios; no DB/HTTP. |

### Cache semantics (read this before relying on it)

- **Key/TTL**: `accounts:<userId>` and `settings:<userId>`, tagged `user:<userId>`,
  TTL `READ_CACHE_TTL_MS` (default 10,000; `0` disables).
- **Read-your-writes in this process**: any write use case invalidates the user's
  tag after it finishes. The domain-event types (`balance.recorded`,
  `account.*`) were not used as the trigger because several writers emit no
  event (custom valuations, display currency, import, demo seed) and events are
  delivered by the worker process, so they cannot protect the web process.
- **Cross-process staleness is bounded by the TTL**: balances written by the
  worker's 6-hourly sync or by another web instance appear within <= 10 s.
  `daysUntilExpiry` is computed at fill time, so it can be up to 10 s old.
- Cached read models are shared and treated as immutable; each caller gets its
  own array copy.

### Proposed DDL (verified on `app_bench`; #1-#3 shipped as migration `0015_perf_indexes`, see section 10)

`scripts/bench/proposed-indexes.sql`. Create with `CONCURRENTLY` in production.

| # | Statement | Why | Measured on 3.7M snapshots / 24k outbox / 30k accounts |
| --- | --- | --- | --- |
| 1 | `CREATE INDEX domain_event_outbox_claim_idx ON domain_event_outbox (available_at, occurred_at, id) WHERE processed_at IS NULL AND dead_lettered_at IS NULL;` (replaces `domain_event_outbox_pending_idx`) | The claim query orders by `(available_at, occurred_at, id)`; the existing index lacks `id`, so Postgres does an incremental sort over every row sharing a leading key (bursts share timestamps). | claim DB time 2.4 ms -> 1.1 ms; plan reads 50 rows instead of 2,001. |
| 2 | `CREATE INDEX domain_event_outbox_processed_idx ON domain_event_outbox (processed_at) WHERE processed_at IS NOT NULL;` | A retention purge by age needs it; processed rows are in no other index. Nothing deletes outbox rows today (see growth below). | enabling index, no read-path effect. |
| 3 | `CREATE INDEX loyalty_account_active_user_idx ON loyalty_account (user_id) WHERE deleted_at IS NULL;` | Worker `listUserIds` is `SELECT DISTINCT user_id ... WHERE deleted_at IS NULL`: today a scan of the whole table. | 5.8 ms -> 2.9 ms DB, 435 -> 35 buffer hits at 30k accounts; scales with accounts (1.5M accounts at 100k users). |
| 4 | *Rejected*: `(loyalty_account_id, captured_at DESC, id DESC) INCLUDE (points, source)` on `balance_snapshot` | Looked like the ideal index for the probes. | 401 -> 406 buffer hits, <0.2 ms, +~250 MB per 3.7M rows. Not worth it. |

Index hygiene (from `pg_stat_user_indexes` after the full run; the outcome is in section 10.3): `loyalty_account_user_id_idx`
(9 scans) is a strict prefix of `loyalty_account_user_provider_unique`; drop it.
`loyalty_account_deleted_at_idx` (1 scan, near-constant column) is not useful;
drop it. `loyalty_account_expires_at_idx` has 0 scans; keep only if a global
"expiring soon" worker query is planned, else drop. All are write-amplification
for no read benefit. `balance_snapshot_pkey` is 212 MB on a long varchar id
(uuid-typed ids would roughly halve it); `balance_snapshot` is ~59% index bytes.

### Pool sizing (measured)

`accounts` route, cache off, 64 connections, 1,500 principals: pool 2 / 5 / 10 /
20 -> 138 / 157 / 170 / 134 RPS (noise +-15%). Node is CPU-bound well before
connections are, so more than ~5-10 connections per process buys nothing on
this workload and costs Postgres backends. Keep `max=10` (default) per web
instance and per worker.

### Worker fan-out (`bench:fanout`, `--users=12 --latency=40`, pool 10)

| per-user concurrency x users in flight | syncs/s | speedup |
| --- | ---: | ---: |
| 1 x 1 (previous behaviour) | 20 | 1.0x |
| 2 x 1 | 40 | 2.0x |
| 4 x 1 (new default) | 76 | 3.8x |
| 8 x 1 | 130 | 6.5x |
| 4 x 4 | 250 | 12.4x |
| 8 x 4 | 367 | 18.1x |

With `--latency=0` (database/Node ceiling, 40 users) throughput saturates at
~390 syncs/s (~2.5 ms per sync: lookup, insert, update, activity, outbox in one
transaction), reached at 8 in flight; going wider only queues on the pool. Real
provider fetches take far longer than 40 ms, so concurrency is bounded by
provider rate limits, not by us. *Estimate*: 100k users x 15 accounts = 1.5M
syncs per 6 h = ~70/s; trivial for one worker in DB terms, needs
~70 x (provider latency in seconds) syncs in flight.

## 6. Settings and trade-offs

| Env | Default | Effect |
| --- | --- | --- |
| `READ_CACHE_TTL_MS` | `10000` | Accounts/settings read cache TTL; `0` disables. |
| `AUTH_CACHE_TTL_MS` | `0` (off) | Caches successful bearer-token lookups (key = SHA-256 of the token). Skips the token query and `last_used_at` touch. A revocation made through this instance is immediate; one made on another instance is honoured after the TTL. Use 5000 only if that is acceptable. |
| `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_SECONDS` | `10` / `30` | postgres.js pool. |
| `SYNC_USER_CONCURRENCY` | `1` | Worker: users synced in parallel (x per-user fan-out of 4 <= pool size). |
| `AUTH_TOUCH_INTERVAL_SECONDS` | `300` | Minimum gap between `access_token.last_used_at` writes per token. The write is fire-and-forget; failures are logged (`token_touch_failed`) and never change the auth result. `0` touches on every request. |
| `WORKER_PURGE_INTERVAL_SECONDS` / `OUTBOX_RETENTION_DAYS` / `ACTIVITY_RETENTION_DAYS` | `3600` / `14` / `365` | Retention job cadence and ages. |
| `PURGE_BATCH_SIZE` / `PURGE_MAX_ROWS_PER_RUN` | `1000` / `50000` | Rows per DELETE statement / per table per run. |
| `LOG_LEVEL` | `info` | `warn` removes the per-request JSON log line (+18-37% RPS on cached routes in the hot run). |

## 7. Growth risks that are not performance problems yet

- **`balance_snapshot` growth is the dominant cost.** Every sync inserts a row
  even when the balance is unchanged: 4 syncs/day x 15 accounts = 60 rows per
  user per day, *estimate* 6M rows/day (~1.2 GB/day with indexes) at 100k users.
  Options: skip or "heartbeat-update" unchanged readings (changes the meaning of
  `sincePrevious`, needs a product decision), downsample history older than
  ~90 d to daily, and range-partition by `captured_at` (monthly) so retention is
  `DROP PARTITION`. Partitioning needs the PK to include `captured_at`; plan it
  with the migrations owner.
- **`domain_event_outbox` and `activity_event` never shrank.** Fixed by the
  `purge` worker job (section 10, [events.md](./events.md#retention-purge-job)).
  Partition the outbox monthly only if volume warrants. The claim index stays
  small because it is partial.
- **Token `last_used_at` touch** was a synchronous write once a minute per
  active token on the request path (`TOUCH_INTERVAL_MS = 60s`; at 10k active
  tokens ~170 writes/s of pure bookkeeping). Now fire-and-forget with a 300 s
  default interval (section 10).
- **Rate limiter and caches are per instance** (in-memory). Effective limits and
  staleness scale with instance count; use a shared store when that matters.

## 8. Go or not (honest verdict)

**No Go rewrite, for any component profiled so far.**

- The only CPU-bound hot spot found in the request path was parsing and
  reducing thousands of rows that SQL could have skipped; fixing it in SQL gave
  ~3x on the use case and 2.5-4x on HTTP RPS. A rewrite would have optimised
  work that should not exist.
- With the data path fixed, time is in the HTTP framework, tracing and logging:
  rewriting domain code does not touch any of it. The next gains are
  horizontal scale, log sampling and a shared cache.
- The MCP server's CPU (zod schema construction per request) is a ~10-line
  TypeScript fix.
- The worker is I/O-bound on provider latency: fan-out in Node scales it
  linearly until the pool or provider limits bind (section 5).
- The deals/redemption optimizer was **not** profiled here (separate
  workstream). Go would only be justified if a profile of that engine shows
  sustained single-thread CPU time that worker threads cannot parallelise, for
  example search over a graph large enough that p99 exceeds the request budget
  at a realistic input size. If that ever happens, the seam is a port in
  `application/` (an `Optimizer`/`RedemptionPlanner` interface taking plain
  JSON-serialisable inputs and returning the plan), implemented by an
  out-of-process adapter (gRPC/HTTP sidecar) so the TypeScript implementation
  stays as the reference and fallback. Measure first with
  `node --cpu-prof` on the planner with a 60-account portfolio and the full
  transfer-partner graph; try `worker_threads` and algorithmic fixes before a
  second language.

## 9. Capacity guidance (estimates)

*Estimates derived from the sandbox numbers above; validate on real hardware.*

- **One Node web instance (1 vCPU)**: ~250-400 RPS of cached authenticated
  reads, ~150-250 RPS uncached (3 queries), ~600 RPS unauthenticated. Plan at
  50-60% utilisation: **~150 RPS per vCPU**. A user session is ~10 requests per
  active minute, so one vCPU carries roughly **1-1.5k concurrently active users**,
  i.e. on the order of **30-50k monthly users per vCPU** at a few percent peak
  concurrency. Scale web horizontally; it is stateless apart from the caches.
- **Connections**: `instances x DB_POOL_MAX (10) + worker (10) + admin/migrations`
  must stay under ~80% of `max_connections` (100 default; RDS sizes it by
  memory). Introduce **PgBouncer in transaction mode** (already supported:
  ports 6432/6543 or `?pgbouncer=true` turn prepared statements off, compose
  profile `pgbouncer`) when `instances x pool` approaches ~60-80, or with
  serverless/short-lived instances. Do not raise the pool to buy throughput: it
  did nothing here.
- **Read replicas**: reads are ~95% of traffic and tolerate the cache's 10 s
  staleness, so a replica for `list*/get*` paths is a natural first scale-out of
  the database. The repository layer takes one `Database`; add a second handle
  for read repositories (outbox, consent, token auth and anything that must see
  its own write stay on the primary). Not implemented.
- **Database size**: ~200 B/snapshot including indexes: 2k users -> 0.7 GB;
  100k users with no retention -> ~37 GB after the first ~125 snapshots/account
  and growing ~1.2 GB/day (section 7). Memory-wise the hot set is the
  `balance_snapshot_account_captured_idx` (~217 MB at 3.7M rows, ~11 GB at
  190M); partitioning or retention keeps it in RAM.
- **Partitioning candidates**: `balance_snapshot` (by `captured_at`, monthly),
  `domain_event_outbox` (by `occurred_at` or `processed_at`, monthly),
  `activity_event` (by `occurred_at`). Everything else is small.
- **Worker**: one instance covers ~390 syncs/s of local DB work; the practical
  limit is provider concurrency. Shard by `hash(user_id) % N` across workers if
  needed; the outbox claim already uses `FOR UPDATE SKIP LOCKED` so multiple
  outbox workers are safe.

## 10. Follow-up: leftovers closed

### 10.1 MCP hot path

`apps/mcp/src/server.ts` used to call `registerTool` 20 times per request with
raw zod shapes; the SDK turns each shape into a `z.object` on registration, so
every request rebuilt ~20 object schemas (plus their `output` shapes) and a new
`McpServer`. Now:

- the tool table (`TOOL_DEFS`: name, title, description, annotations, compiled
  `z.object` input/output schemas, and a handler *factory*) is built once at
  module load and shared, immutable;
- per request, `createPointUpMcpServer` still creates a cheap `McpServer`
  (the SDK's `Protocol` binds to exactly one transport, so a shared server is
  not possible in stateless mode) and registers the shared definitions, binding
  the handlers to that request's `{ client, appUrl, agentName }` context.
  No token is ever module state: the client (with the caller's bearer token) is
  created per request and captured only by that request's handler closures.
  `apps/mcp/test/isolation.test.ts` fires 60 parallel requests with distinct
  tokens and random upstream latency and asserts every upstream call carries
  exactly its own token; tool names, schemas and outputs are unchanged (all
  prior MCP tests pass).

Measured with `npm run bench:mcp-inproc` (new: MCP HTTP transport + tool dispatch
against an instant stub upstream, so it isolates the MCP server itself; 16
connections, 8 s, 300 rotating tokens, same sandbox):

| Tool call | RPS before | RPS after | p50 before | p50 after | p99 before | p99 after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `pointup_list_accounts` | 172 | 480-505 | 88 ms | 29-31 ms | 206 ms | 55-57 ms |
| `pointup_list_providers` | 205 | 612-634 | 74 ms | 24-25 ms | 133 ms | 42-49 ms |

CPU profile of the same run: zod 29.9% -> 11.3% of busy time, GC 24.0% -> 8.8%.
What remains is per-request argument/output validation, the SDK's JSON-RPC
plumbing and Node's HTTP stack. (The full-stack `bench:mcp` number is bounded by
the web app behind it, so it moves much less; use `bench:mcp-inproc` to see the
MCP server's own cost.) `tools/list` still converts schemas to JSON Schema per
request; it is rare and was left alone.

### 10.2 Token `last_used_at`

`AuthenticateAccessToken` no longer awaits the touch: it is started and
forgotten, errors are swallowed and reported through an `onTouchError` hook
(web logs `token_touch_failed`), and the throttle is
`AUTH_TOUCH_INTERVAL_SECONDS` (default 300, was a hard-coded 60 s). The write
uses the new `AccessTokenRepository.touchLastUsed(id, at)` (one column, `WHERE
revoked_at IS NULL`) where available, so a background touch can never overwrite
a concurrent revocation with a stale full-row `update` (a real race once the
write is no longer awaited). Authentication results are unchanged. The
`last_used_at` shown in the dashboard is now up to 5 minutes stale.
Tests: `packages/core/test/auth-touch.test.ts`.

### 10.3 Index migration `0015_perf_indexes`

Applied: the three verified proposals plus one purge-enabling index, and two drops.

| Change | Evidence on `app_bench` (30k accounts, 35k outbox, 91k activity rows; after `VACUUM ANALYZE`) |
| --- | --- |
| `+ domain_event_outbox_claim_idx (available_at, occurred_at, id) WHERE processed_at IS NULL AND dead_lettered_at IS NULL`, `- domain_event_outbox_pending_idx` | Claim `EXPLAIN`: `Index Scan using domain_event_outbox_claim_idx`, `LockRows` over exactly 50 rows, 0.15 ms (was 2.4 -> 1.1 ms on the old index in section 5). The new index has the same predicate and a superset of columns, so the dead-letter sweep is served too. |
| `+ domain_event_outbox_processed_idx (processed_at) WHERE processed_at IS NOT NULL` | Purge select `ORDER BY processed_at LIMIT n FOR UPDATE SKIP LOCKED`: `Index Scan using domain_event_outbox_processed_idx`, 0.04 ms. |
| `+ loyalty_account_active_user_idx (user_id) WHERE deleted_at IS NULL` | `listUserIds` (`SELECT DISTINCT user_id ... WHERE deleted_at IS NULL`): `Index Only Scan using loyalty_account_active_user_idx`, `Heap Fetches: 0`, 3.9 ms vs 8.4 ms and 37 vs 457 buffers for the seq scan without it (needs a vacuumed table for the index-only plan; autovacuum does that in production). Per-user `WHERE user_id = ? AND deleted_at IS NULL` also uses it (0.03 ms). |
| `+ activity_event_occurred_idx (occurred_at)` (not in the proposal; required by the purge) | The age purge on `activity_event` is global, and `activity_event_user_occurred_idx` leads with `user_id`, so without it each batch is a seq scan: 19 ms on 91k rows with nothing to delete, growing linearly. With it: `Index Scan`, 0.03 ms. Cost: one more index on an append-mostly table. |
| `- loyalty_account_user_id_idx` | Verified redundant (transactional `DROP INDEX`, `EXPLAIN`, `ROLLBACK`): `WHERE user_id = ?` plans to `Bitmap Index Scan on loyalty_account_user_provider_unique` both with and without it (0.27 -> 0.05 ms, noise from cache state; the planner already preferred the composite: 43,515 scans vs 15 for `_user_id_idx`), and the soft-delete-filtered variant uses the new partial index. |
| `loyalty_account_deleted_at_idx` **kept** | 1 scan, near-constant column, so almost certainly dead weight, but "no scans in a bench run" is not proof for a column some admin/cleanup query might filter on. Revisit with production `pg_stat_user_indexes` after a few weeks. `loyalty_account_expires_at_idx` (0 scans) kept for the same reason. |

Plain `CREATE INDEX` (not `CONCURRENTLY`) because drizzle migrations run inside a
transaction and `CREATE INDEX CONCURRENTLY` cannot. The tables are small to
medium and the lock only blocks writes for the build time (sub-second at the
benchmark size); the migration file says how to pre-create an index by hand on a
very large table. New indexes are created before the old ones are dropped.
`drizzle-kit generate` reports "No schema changes" after this migration.

### 10.4 Retention (`purge` job)

See [events.md](./events.md#retention-purge-job) for what is deleted and kept
(dead-lettered outbox rows, balance snapshots and agent observations are never
purged), the knobs, and the log line. Implementation:
`packages/core/src/infrastructure/retention/` (policy + orchestration +
`DrizzleRetentionStore`), `apps/worker/src/jobs/purge.ts`. All four targets
materialize their bounded eligible IDs once using
`WITH selected AS MATERIALIZED (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)`;
`DELETE ... USING selected` consumes that fixed claim set. The cutoff and
retention predicates are unchanged, including keeping dead-lettered outbox
rows and never purging balance snapshots or agent observations.

The old locking `IN` subquery could reevaluate its selector and exceed the
statement limit ([PostgreSQL explanation](https://www.postgresql.org/message-id/16497.1553640836@sss.pgh.pa.us)).
Master CI on 2026-10-02 observed 25 deletions in one batch requested at 10,
exceeding the run cap of 20; its exact execution plan is unknown. The new worker
code is required for the batch guarantee. Local focused PostgreSQL verification
did not execute because the shared queue returned exit 75; there was no unchanged
retry. Committed-source database verification remains pending, and a production
rollout has not been established. The integration
coverage checks bounded statements, run caps and concurrent nonduplicate
purges; see [events.md](./events.md#retention-purge-job) for the full policy.

### 10.5 `balance_snapshot` monthly partitioning plan (NOT IMPLEMENTED)

Why: it is the dominant table (section 7). Range partitioning by `captured_at`
makes retention `DROP`/`DETACH PARTITION` (instant, no bloat, no vacuum debt)
instead of a huge `DELETE`, and keeps the hot index (`account, captured_at`)
small per partition, so recent months stay in RAM. The access pattern is already
partition-friendly: latest/previous/30 d/90 d probes touch only the newest
partitions (Postgres prunes on the `captured_at <= $x` bound; "latest" with no
bound visits partitions newest-first and stops at the first hit via
`ORDER BY captured_at DESC LIMIT 1`, so keep partitions ordered and the probes as
they are).

Constraints that shape the DDL:

- A primary key on a partitioned table must include the partition key, so the PK
  becomes `(id, captured_at)`. Nothing in the app looks a snapshot up by `id`
  alone (verify with `grep` before the migration), and ids are not referenced by
  any FK, so this is safe. Keep `id` unique in practice (uuid).
- The FK `loyalty_account_id -> loyalty_account(id) ON DELETE CASCADE` is
  supported on partitioned tables (PG 12+ for referencing a non-partitioned
  table). Cascading deletes touch every partition for that account, via the
  per-partition index.

Sketch (monthly, created ahead by a job):

```sql
CREATE TABLE balance_snapshot_new (
  id                 varchar(255) NOT NULL,
  loyalty_account_id varchar(255) NOT NULL REFERENCES loyalty_account(id) ON DELETE CASCADE,
  points             bigint       NOT NULL,
  source             varchar(16)  NOT NULL,
  captured_at        timestamptz  NOT NULL,
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE INDEX balance_snapshot_account_captured_idx
  ON balance_snapshot_new (loyalty_account_id, captured_at DESC, id DESC);  -- propagates to partitions

CREATE TABLE balance_snapshot_default PARTITION OF balance_snapshot_new DEFAULT;
CREATE TABLE balance_snapshot_2026_10 PARTITION OF balance_snapshot_new
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- ... one per month; the `purge`/maintenance job creates month N+2 ahead of time
```

Migration strategy (zero-downtime, in order; drizzle cannot express partitions,
so these are hand-written SQL migrations plus `drizzle-kit` schema left
describing the logical table):

1. Add the maintenance job (create next 2 months, alert if the DEFAULT partition
   is non-empty). Ship and watch it first.
2. Create `balance_snapshot_new` with partitions covering existing data (min
   `captured_at` to now + 2 months).
3. Dual-write: deploy repositories that insert into both tables (or use a
   trigger on the old table copying inserts to the new one).
4. Backfill in `captured_at` order in bounded batches (10-50k rows,
   `INSERT ... SELECT ... WHERE captured_at >= a AND captured_at < b ON CONFLICT
   DO NOTHING`), throttled; run `ANALYZE` per partition when done.
5. Verify: row counts and a checksum per month, and `bench:queries` p50 on both.
6. Swap in one short transaction: `ALTER TABLE balance_snapshot RENAME TO
   balance_snapshot_old; ALTER TABLE balance_snapshot_new RENAME TO
   balance_snapshot;` (rename the index/constraint names to match the schema),
   stop dual-write. Keep `_old` for a release, then drop it.
7. Retention then becomes `ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY` +
   archive/drop for months beyond the policy, if the product decides on one
   (today history is kept forever and snapshots are never purged).

Rollback: until step 6 the old table is authoritative and complete; after it,
rename back. Do the dry run on a restored copy sized like production before
touching it. Not worth doing below roughly 100M rows (~20 GB); the section 9
estimate says that is ~1 month at 100k users, or years at 2k.

### 10.6 Open product question: skip unchanged readings on sync

Every sync inserts a `balance_snapshot` even when the balance is identical to
the previous one (4 syncs/day x 15 accounts = 60 rows/user/day). Skipping or
"heartbeat-updating" unchanged readings would cut growth by an estimated 80-95%
(most balances change rarely), but it changes visible behaviour, so it needs a
decision:

- `sincePrevious` / trend semantics: today "previous" is the previous *reading*;
  without unchanged rows it would be the previous *change*, and 30/90-day deltas
  would need to be computed as "latest at or before T", which the current LATERAL
  probes already do (so trends keep working, but `previous` changes meaning).
- "Last synced" freshness: needs a separate `last_synced_at` on the account (or
  a heartbeat update of the latest row) so the UI can still say "checked 2 h ago".
- Expiry projection and activity feed: "balance unchanged" events and any
  inactivity-based expiry logic that counts a sync as activity must keep working
  (a sync is not account activity for most programs, but confirm).
- History charts: flat segments are implied, not stored; charts must carry the
  last value forward.

Question for the product owner: is "one row per sync" a feature (an audit of
when we looked) or an implementation detail? If detail, the recommended option is
to skip the insert when `points` equals the latest and update a
`loyalty_account.last_synced_at`; if feature, downsample rows older than ~90 days
to daily instead.
