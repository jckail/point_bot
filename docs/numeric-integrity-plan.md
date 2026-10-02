# Numeric integrity and backfill preservation: proposed additive 0020

Status: original audit after observation integration `d9ffc38`; the bounded source phase below is now implemented locally, with exact release CI recorded separately in integration-status.md.
The changes below are a proposed next phase, not implemented migration SQL or
verified production data. Only this document was added. Root owns verification
of that release checkpoint, schema changes, database access and deployment.
Preserve migrations 0000–0019 and the guarantees in
[observation-integration-plan.md](observation-integration-plan.md).

The Graphify skill's shared query was tried first with repository-qualified
numeric/storage symbols. Returned code belonged to other repositories, with
unrelated investigation references; it supplied no PointUp code evidence.
Findings below use current integration source and the preserved native release
at `/home/jkail/projects/point_bot-release`. No live database, provider, expensive
check or application edit was performed for this audit.

## Current invariants and concrete gaps

| Boundary | Current behavior and gap | Compatible next change |
| --- | --- | --- |
| Snapshot points | `bigint` with Drizzle `mode: number`; factory checks `Number.isInteger`, which accepts integers beyond exact JS representation. Raw latest/trend reads also call `Number(row.points)` without a range check. | Require nonnegative safe integers in the factory and adapters; audit legacy values as PostgreSQL integers before number conversion. |
| Goal targets | `bigint`/number; create/update domain validation accepts positive unsafe integers. | Positive safe integer, including direct callers and existing-goal updates. |
| Observation points | Migration 0019 checks version-1 points and nullable previous points against `9007199254740991`; service checks safe integer input. Historical version-0 rows intentionally bypass those checks. | Preserve the legacy boundary; inventory invalid version-0 values rather than retroactively assuming they passed validation. |
| Custom valuation | Domain accepts finite `0 < centsPerPoint <= 100`; adapter rounds `value * 1000` to int4. Values such as `0.0001` persist as zero, and the immediate response can differ from the next read. | Validate and return the normalized milli-cents value; persisted range `1..100000`. |
| Watch threshold | Same positive/100 cap and milli rounding problem. | Normalize threshold once in domain/application before persistence, with persisted range `1..100000`. |
| Best observed watch rate | `recordCheck` accepts arbitrary numeric outcomes; adapter rounds to int4. This is an observed value, not the user's threshold. It has no domain cap of 100. | Require finite nonnegative normalized value representable as int4 milli-cents; retain NULL for unknown. Do not apply the threshold cap to observed rates. |
| Money and totals | Estimated cents multiply points by rates and use `Math.round`; summaries/goals add numbers; transfers multiply before division. Individually valid operands can yield unsafe intermediate/final integers. | Use exact checked arithmetic and explicit overflow behavior; row bounds alone cannot establish valid aggregates. |
| Backfilled balance metadata | Manual/agent recording unconditionally calls `refreshExpiryFromActivity(account, capturedAt)`, which sets both expiry and `updatedAt` to values derived from the historical reading. | Preserve historical capture time and exact receipt ID while preventing account metadata regression under the existing account lock. |

Installed Zod v4 integer checks already reject unsafe integer wire values. This
does not protect direct domain calls, provider/sync inputs, CSV parsing or raw
SQL. Keep the existing MCP int4 input ceiling; do not shrink the portfolio's
bigint-safe domain to int4. The intended common persisted point bound is
`0..9007199254740991`, with goals strictly positive.

Sources: [schema](../packages/core/src/infrastructure/db/schema.ts),
[snapshot factory](../packages/core/src/domain/loyalty/balance-snapshot.ts),
[goal factory/update/progress](../packages/core/src/domain/loyalty/trip-goal.ts),
[balance adapters](../packages/core/src/infrastructure/repositories/drizzle-loyalty-account-repository.ts),
[contracts](../packages/core/src/contracts/index.ts),
[0019 checks](../packages/core/drizzle/0019_observation_provenance_replay.sql).

## Preservation compared with the native branch

Native `domain/loyalty/balance-snapshot.ts` and `trip-goal.ts` use safe-integer
validation. Its migration `0009_portfolio_integrity.sql` stages snapshot points,
goal targets and vocabulary checks as **NOT VALID**, retaining invalid historical
rows. Reuse that staged approach through a new migration, not its migration
number/history, tags conversion or goal relation rewrite: integration already
has PR14 tags and tenant-qualified goal migration 0018.

The native snapshot source check permits only `sync/manual`. Integration requires
`sync/manual/agent`; copying that check would break preserved agent recording.
Likewise preserve current IDs, account-tag relations, source labels, review
transitions, activity, outbox and retention. Native manual recording deliberately
does not refresh expiry because viewing a balance is not proof of qualifying
earn/redeem activity. PR14 currently does refresh it. This semantic difference
requires an explicit product decision; it must not be silently imported as a
numeric migration side effect.

## Narrow source phase before DDL

1. Replace integer-only guards with `Number.isSafeInteger` for snapshot/goal
   creation and mutation. Validate CSV numeric tokens before lossy conversion:
   reject/skip an unsafe claim using the existing import outcome protocol, never
   clamp it to zero/MAX_SAFE. Accept existing legitimate integer formats only
   through a documented parser. Import already clamps future times to now;
   leave that separate timestamp policy explicit rather than expanding clamping.
2. Centralize milli-cents normalization with field-specific bounds. Retain the
   current nearest-milli rounding policy for representable inputs, reject values
   whose normalized threshold is zero, and return/store the normalized number.
   Do not make storage adapters secretly choose a different value. Best-seen
   rates permit `0..2147483647` milli-cents or NULL, not the threshold's 100000
   ceiling. Reject invalid scraper/domain numeric outcomes before notification,
   watch bookkeeping or event publication. Fixed safe public errors must use the
   existing closed error catalog or a narrowly added documented code.
3. Guard database-to-number boundaries. Raw bigint strings can be parsed as
   BigInt and range-checked before conversion. Drizzle number-mode mapping may
   already have lost precision: reject out-of-range mapped numbers and use an
   exact raw/string projection for inventory/diagnostics. An invalid legacy row
   must produce explicit unavailable/repair behavior, not a rounded balance,
   an invented zero or silent removal from totals. A new response status requires
   coordinated DTO/client work; until then fail safely with the error protocol.
4. Add checked sums/products for summaries, goal progress, valuation, transfer
   ranking and optimizer calculations. Use BigInt for integer points, rational
   transfer/permille intermediates and integer milli-cents; preserve existing
   floor order (base conversion, then bonus) and nearest-cent rounding. Rates
   from the editorial catalog need an explicit rational/precision policy too;
   do not silently quantize every floating estimate with a global helper.
   Convert to number only after checking the final integer range. Existing
   number DTOs cannot encode larger exact totals: choose a fixed safe overflow
   error for this bounded phase, rather than saturation, unless separately
   approving an additive exact-string/unknown-value contract.

Sources: [CSV import](../packages/core/src/application/loyalty/import-portfolio.ts),
[valuation domain](../packages/core/src/domain/loyalty/custom-valuation.ts),
[valuation use case](../packages/core/src/application/loyalty/custom-valuations.ts),
[valuation adapter](../packages/core/src/infrastructure/repositories/drizzle-custom-valuation-repository.ts),
[watch domain](../packages/core/src/domain/loyalty/award-watch.ts),
[watch adapter](../packages/core/src/infrastructure/repositories/drizzle-award-watch-repository.ts),
[watch loop](../packages/core/src/application/loyalty/award-watches.ts),
[scrape extraction](../packages/core/src/application/loyalty/ingest-deal-page.ts),
[money mapping](../packages/core/src/application/loyalty/mappers.ts),
[summary](../packages/core/src/application/loyalty/get-portfolio-summary.ts),
[transfer math](../packages/core/src/domain/loyalty/transfer-partners.ts),
[bonus math](../packages/core/src/domain/loyalty/bonus-math.ts),
[optimizer](../packages/core/src/domain/loyalty/optimizer.ts).

## Backfill, expiry and transaction policy

Keep backdated snapshots legal: `capturedAt` remains the claimed historical time;
latest snapshot selection remains `captured_at DESC, id DESC`; the exact inserted
ID comes from `executeWithSnapshotId`, not a latest-row lookup. No 30-day native
capture limit should be introduced. History reads currently order only by capture
time; align their tie-break with latest/trend selection for deterministic paging.

The minimum compatible fix retains PR14's forward-reading expiry behavior but
prevents backfilled readings from overwriting newer account metadata. Under the
existing locked-account UOW, inspect the previous latest snapshot and current
account timestamp before applying an activity-derived expiry. Preserve current
expiry on older readings, including explicit overrides and NULL. Use transaction
wall-clock mutation time for `updatedAt`, with a deliberate policy for a stored
future timestamp; never assign historical `capturedAt` to it. Test forward and
backfill cases separately. Before implementing, root should settle whether
balance viewing should refresh inactivity at all; the native alternative is to
preserve expiry for both manual and agent readings. Neither branch provides
provider evidence of qualifying activity.

Do not repair existing expiry values by blindly replaying balance history: a
balance timestamp does not identify the last earn/redeem, and a stored override
is not distinguishable from every historical projection. Audit suspicious
`updated_at` regressions and expired projections with independent timestamps and
provider/user evidence. Preserve originals and the repair reason; no fabricated
qualifying-activity timestamp.

Snapshot, account metadata, activity, observation transition and outbox still
commit together through production `DrizzleUnitOfWork`. Manual/sync writes already
share account serialization; observation/review locks and authorization closures
remain. Validate before writes and again where needed after waits; any constraint,
normalization, overflow or outbox failure must roll back the complete mutation.
Do not infer production atomicity from default `noopEventing` (atomic false).
Import intentionally commits separate linked-account/reading operations today;
do not describe the whole CSV as atomic or retrofit compensation silently.

Sources: [manual/agent recording](../packages/core/src/application/loyalty/record-manual-balance.ts),
[expiry helper](../packages/core/src/domain/loyalty/loyalty-account.ts),
[sync](../packages/core/src/application/loyalty/sync-loyalty-account.ts),
[transaction/outbox](../packages/core/src/infrastructure/outbox/drizzle-outbox.ts),
[eventing defaults](../packages/core/src/application/events/ports.ts).

## Proposed managed 0020 and legacy adoption

Append `0020_numeric_integrity` after the actual 0019 journal, with matching
Drizzle schema/snapshot metadata. Do not edit prior migrations or use a forced
schema push. Initial checks should be **NOT VALID**, enforcing future writes
without scanning/rejecting the entire historical database during deployment:

| Table/field | Proposed predicate |
| --- | --- |
| `balance_snapshot.points` | `BETWEEN 0 AND 9007199254740991` |
| `balance_snapshot.source` | `IN ('sync','manual','agent')` |
| `trip_goal.target_points` | `BETWEEN 1 AND 9007199254740991` |
| `trip_goal.status` | `IN ('active','achieved','archived')` |
| `user_provider_valuation.cents_per_point_milli` | `BETWEEN 1 AND 100000` |
| `award_watch.min_cents_per_point_milli` | `BETWEEN 1 AND 100000` |
| `award_watch.best_seen_cents_per_point_milli` | `IS NULL OR >= 0` (physical int4 supplies the upper bound) |

Existing transfer bonus multiplier/window checks already enforce `(1000,3000]`
and end after start; do not duplicate or loosen them. Existing version-1
observation checks remain. Blanket observation checks would make an invalid
legacy held row impossible even to reject because NOT VALID still checks updated
rows. Inventory those rows and define cleanup/repair before adding broader
checks. Similarly, unrelated updates to an invalid legacy goal/watch may fail
new checks: provide safe repair behavior and operator diagnostics instead of
claiming NOT VALID makes every old mutation compatible.

For each affected table, a controlled preflight must count invalid values and
inspect exact bigint text, primary keys, owner references and constraint state
using SQL, before ORM number mapping. Inspect journal/schema types against the
actual deployment; specifically verify bigint/int4, not assumed native columns.
SQL predicates should mirror the table above, plus inventory legacy observation
points/previous-points, invalid dates (`NOT isfinite(...)`), future capture claims
and invalid source/status vocabulary. A read-only point query is, for example:

```sql
SELECT id, loyalty_account_id, points::text
FROM balance_snapshot
WHERE points < 0 OR points > 9007199254740991;
```

Counts/private IDs belong in an operator-controlled report, not application
logs, hosted memory or public release notes. Preserve an exact recoverable backup
before repairs. Recommended first migration leaves invalid rows untouched behind
staged checks. If quarantine becomes necessary, use an additive server-only RLS
table with stable original table/key, exact original row, reason, migration/run
provenance and capture timestamp; deny public access and make archival idempotent.
Archive and any exclusion/repair under the same transaction and table/row locks.
No archive-then-delete race, blanket numeric clamp, automatic guessed replacement,
loss of snapshots referenced by observation witnesses, or silent account cascade.

Only explicitly reviewed repairs should change authoritative history. Re-run the
exact predicates, then validate each named constraint separately after its own
zero-invalid proof. Keep constraint validation state in the release record;
zero drift is metadata agreement, not valid historic data. Use bounded lock and
statement timeouts with a deliberate retry after diagnosis. Deploy compatible
writers and apply managed DDL before activation, preserving the existing
migration-before-host production gate and direct/session-pooler migration policy.

## Focused implementation ownership and acceptance tests

- Domain/application owner: point/goal guards, CSV parsing, milli normalization,
  safe arithmetic and settled backfill policy. Adapter owner: exact mapped-value
  guards, deterministic history order and persistence of normalized rates.
  Schema owner: additive 0020/check names/journal metadata and legacy inventory;
  HTTP/client owner: fixed overflow/repair error mapping only where required.
  Root owns deployed-data decisions, aggregate checks and real PG fixtures.
- Domain tests: zero allowed for balances, zero rejected for targets; safe max
  accepted, max+1/negative/fraction/NaN/infinity rejected. Exercise direct calls,
  sync and CSV, not only Zod. Negative/unsafe historic rows must not become zero.
- Normalization tests: `0.0001` rejected, smallest normalized positive accepted,
  100 accepted/over-100 rejected, non-milli inputs round consistently and response
  equals readback. Best-seen zero/NULL and values above 100 remain valid when
  representable; negative/nonfinite/int4-overflow outcomes fail without a hit,
  watch mutation or outbox event.
- Exact calculation tests: compare boundary point/rate/permille products against
  BigInt reference results, including safe final results with unsafe intermediate
  products. Two individually safe accounts whose sum is unsafe must fail
  explicitly. Preserve transfer double-floor and rounding ties for normal data.
- Backfill tests: newer snapshot plus old manual/agent capture preserves current
  balance and expiry, uses exact backfill ID, retains historical activity time,
  and cannot regress `updatedAt`. Cover explicit expiry, NULL, same-time ID ties,
  and forward reading policy. Race a backfill against sync/account metadata and
  verify the shared lock preserves the winner's current metadata.
- Real PostgreSQL adoption tests: seed valid/invalid old rows before 0020,
  preserve exact originals through NOT VALID adoption, reject new/direct invalid
  inserts and updates, keep `agent` sources, reject unsafe values without rounded
  readback, inspect `pg_constraint.convalidated`, prove validation refuses dirty
  data and succeeds only after an explicit fixture repair. Include a bounded
  concurrent writer during adoption; prove rollback preserves history/metadata
  and outbox for check/outbox failures.
- Preserve migration 0019's rotation/replay/legacy-NULL review cases and production
  atomicity tests. Re-run only affected tests during iteration; root runs the
  gated aggregate once after source/DDL settle. No tests were run for this
  documentation-only audit and no production-data clearance is claimed.

Original live provider/browser/OpenAI verification, numeric/RLS review beyond
this bounded phase and release gates remain in [release-backlog.md](release-backlog.md).

## Implemented bounded backfill metadata policy

Manual and agent balance recording now compares the capture time against both
latest balance capture and locked account `updatedAt`. If the capture precedes
either timestamp, the write retains current expiry, including an explicit
override or NULL. Forward readings retain PR14's activity-derived expiry refresh
from capture time; this compatibility change does not establish provider evidence
of qualifying activity or change sync behavior. Account metadata uses the fresh
transaction mutation clock rather than historical capture time. A stored future
`updatedAt` is deliberately retained instead of silently repaired by a reading.
The exact inserted snapshot ID, historical activity timestamp and existing
transaction/outbox boundaries are unchanged. Focused fake-adapter tests verify
this policy; production PostgreSQL race/rollback validation is a separate gate.

Sync uses the same metadata guard after acquiring the account lock: its provider
reading retains the original capture time, while a newer reading or metadata
edit preserves locked expiry. Ordinary forward sync still refreshes expiry.
Metadata mutation uses the fresh post-wait clock and preserves a stored future
timestamp. Focused simulated lock-race tests cover explicit and NULL expiry;
production PostgreSQL barriers remain separately owned verification.

Optimizer capacity and funding comparisons now use exact integer intermediates;
point DTO sums/products must remain representable. Coverage calculations invert
the shared two-stage transfer flooring exactly, including decimal catalog ratios.
Normal milli-cent funding/ranking rounding and zero valuations retain existing
policy; large internal milli-cent costs use exact decimal intermediates rather
than unsafe integer sums. Monetary DTOs reject unrepresentable/nonfinite outputs.
Trend deltas validate source points and compute signed differences exactly.
This bounded pass does not close the separately deferred rate/deal/cash parsing
gaps identified earlier in this plan.

## Bounded numeric storage and calculation implementation

Additive migration 0020 adds seven NOT VALID checks for safe snapshot points,
all three snapshot sources, positive safe goal targets/status, positive normalized
valuation/watch thresholds, and nonnegative observed watch rates. Previous migration
history is preserved. Raw lateral balance reads project integer text before
conversion; all mapped point/goal values and persisted rate reads reject invalid
history instead of silently rounding or replacing it. Invalid old rows remain
unchanged and require explicit repair before validating these constraints.

Direct domain callers enforce safe integers; valuation/watch thresholds normalize
once to nearest milli-cents before responses and storage. Values that round to zero
are rejected. Observed watch rates retain their distinct nonnegative int4-milli
range and unknown NULL. Invalid observed outcomes do not publish hits/events.

Shared point math uses BigInt for exact integer sums/ratios and interprets published
Number.toString decimal valuations as rational numbers, rounding nonnegative cents
up at ties. Portfolio and goal totals, account values, provider estimates and
transfer estimates reject outputs outside existing number DTOs. Transfer conversion
keeps its existing three-decimal ratio policy and separate base/bonus floors. CSV
imports accept exact decimal integers, including integral scientific notation;
fractional claims that Number would round to an integer and unsafe/nondecimal
claims are skipped through the existing import result, without clamping.

Root actual PostgreSQL checks passed eight numeric/adoption cases after correcting
a test-only outbox fixture column omission, plus eight production metadata cases.
These prove actual UOW rollback for snapshot/account/activity/outbox and a real
sync lock-wait barrier. Managed migration through 0020 passed on the owned fixture.
No production legacy rows were inspected or constraints validated. Remaining
scraped rate/deal/cash parsing and broader RLS/rollout audits remain open.

## Deal token and FX follow-up

Fixed reproduced structured-deal truncation:12500 points for$1500 now preserves
12500/150000cents, and$123.4 preserves12340cents. Complete numeric tokens are validated
before exact BigInt scaling. Plain/grouped points must be whole, k amounts permit
up to3 decimals, USD cash permits up to2 decimals, and malformed/unsafe values keep
the existing unstructured-page fallback instead of producing a partial numeric deal.

FX uses the shared exact decimal ratio, signed target-minor-unit rounding and
safe-integer/result-decimal guards. Supported two-decimal currencies and JPY's
zero-decimal policy remain; exact negative ties preserve Math.round semantics.
201USDcents at1.5AUD/USD produces3.02; at0.5EUR/USD produces1.01. Unrepresentable
converted amounts produce an explicit unavailable display, never Infinity or a
silently rounded cent. Existing valuation arithmetic retains its semantics.

Root composed79 focused numeric/deal/extension cases, complete workspace types
and lint pass. Fresh candidate CI is required after committing these changes.
Provider currency inference, scraped rate normalization, other cash boundaries
and actual live financial/provider data remain separate follow-up audits.
