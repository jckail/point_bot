# Portfolio integrity and migration 0009

The application contracts remain unchanged: accounts expose string-array `tags`, and trip goals expose string-array `accountIds`. Migration `0009_portfolio_integrity.sql` changes their persistence without deleting legacy data.

## Goals and tenant ownership

`trip_goal_account(goal_id, user_id, loyalty_account_id, position)` is the canonical membership relation. Its primary key deduplicates account membership. Composite foreign keys reference unique `(id, user_id)` indexes on both parents, so an account and goal must belong to the same owner even for direct SQL writes. `position` retains the first supplied position. Hard deletion of either parent cascades memberships; soft deletion retains existing goal membership and historical progress, preserving the previous behavior.

The migration expands existing `account_ids`, trims tokens and preserves the first occurrence of every valid same-owner reference. Missing and different-owner references are copied into `trip_goal_membership_review`, with their original goal and owner, and excluded from canonical membership. Each invalid-reference review row also retains the exact original CSV in `legacy_account_ids`. After backfill, the public compatibility `account_ids` is rebuilt from canonical owned links, so older hosts cannot read wrong-owner balances through the preserved malformed association. The review table has RLS enabled without public policies and revokes PUBLIC access. Trusted operators can inspect it locally without assigning those references to a different owner. Historical deleted accounts remain linked during backfill to retain existing history.

New and changed goal CSV writes are synchronized by a PostgreSQL trigger in the same statement as the parent mutation. Invalid, wrong-owner and deleted-account references reject the complete write. A failed replacement therefore cannot leave a changed title/target or a partial relation. Parent row locks serialize concurrent updates. Repository reads use one statement with an ordered correlated membership subquery, so parent values and membership come from one database snapshot. Repository updates also include the owner in their WHERE predicate.

Legacy `account_ids` is widened to text so the compatibility projection does not impose the former 2048-character limit. Older host writers remain supported through the trigger. Direct edits to the canonical relation are constrained by owner foreign keys but do not project changes back into legacy CSV; canonical reads reflect such edits. Hard account deletion can consequently leave stale legacy CSV references until the next goal update. Do not use the legacy column for progress or tenant authorization.

## Tags

`tag_values text[]` stores the canonical array and is backfilled from the historical comma-separated tags, applying the existing trim/empty-field behavior. The legacy `tags` column is widened from `varchar(512)` to text, allowing the domain's full twenty tags of thirty-two characters each without truncation.

Current repositories write the canonical array. A trigger projects changed arrays to the legacy CSV and imports legacy-only changes back into the array. An explicit changed array takes precedence over a simultaneously changed CSV, preserving its exact elements, including commas. Current domain tag validation still restricts tags to alphanumeric, underscore and hyphen characters. The array representation also avoids splitting a stored element on unrelated repository updates.

## Staged storage checks

New/changed rows enforce safe JavaScript integer ranges for snapshot points (`0..9007199254740991`) and positive goal targets, plus the supported snapshot-source and goal-status enums. These CHECK constraints are deliberately added `NOT VALID`: existing invalid rows are retained, while new writes are checked immediately. Before deployment, operators must inspect existing violations and plan correction before issuing `VALIDATE CONSTRAINT`. Drizzle snapshots describe the check expressions; PostgreSQL's validation state is part of the SQL migration rather than the snapshot format.

No migration here adds portfolio RLS, an activity foreign key or an account-qualified observation-to-snapshot foreign key. Existing numeric data can still contain unsafe historic rows pending validation. Tenant constraints on goal membership do not replace authenticated application access checks.

## Atomic application writes

`PortfolioUnitOfWork.run(userId, operation)` supplies transaction-scoped account, snapshot and activity repositories. `DrizzlePortfolioUnitOfWork` owns the PostgreSQL transaction, serializes these mutations per owner with a transaction advisory lock, and reads relevant account rows `FOR UPDATE`. The advisory key has a namespace; hash collisions only serialize unrelated owners and never change ownership checks.

`LinkLoyaltyAccount`, `RecordManualBalance` and `ImportPortfolio` accept an optional unit of work after their existing clock argument. When composed with it, linking and its feed entry, recording a snapshot and its feed entry, and the entire import are atomic. Import identity preflight and every account/snapshot/activity write run in the same transaction; concurrent imports for one owner cannot both preflight different membership identities before either writes. Scoped import use cases do not start nested transactions or use outer repositories. The web host supplies this adapter. Hosts that omit the optional dependency retain the old nontransactional behavior, including in-memory fixtures.

This transaction does not span provider network calls or assistant action journaling. The action journal's existing unknown-outcome handling still applies if its result write fails after a successful core mutation. Other mutation use cases are not automatically transactional.

## Verification

`packages/core/test/portfolio-integrity-postgres.test.ts` is opt-in via `PORTFOLIO_INTEGRATION_URL`, independently of the application's `DATABASE_URL`. It requires a fresh disposable loopback database named `pointup_integration` with role `pointup_fixture`. It first applies migrations 0000–0008, seeds legacy duplicate/missing/wrong-owner references and an unsafe historical snapshot, then runs the actual migrator through 0009. Reusing a database already migrated through 0009 does not exercise this backfill scenario.

The suite covers tenant-qualified references, preserved raw review evidence and repaired legacy projections, staged checks, full tag capacity, legacy writer compatibility, parent/relation rollback, concurrent replacements, owner-qualified update predicates, snapshot/activity rollback, whole-import rollback, conflicting concurrent imports and hard/soft-delete membership behavior. It injects failing transaction-scoped repository operations after real writes to establish actual database rollback. Execution results and fixture cleanup are recorded separately in `database-verification.md`; the suite's existence alone is not a passing result.

## Migration serialization

The worker calls `migrateWithLock` before Drizzle performs any schema/journal read. Drizzle itself does not acquire an advisory lock; its installed PostgreSQL dialect reads the latest journal entry before its migration transaction. Concurrent unguarded migrators can consequently decide to apply the same DDL.

PointUp reserves one postgres-js connection and acquires session advisory key `846795951`, shared with the integration fixtures. The lock stays held while the migrator uses another connection for journal reads and its transaction. The dedicated migration pool must have at least two connections; a single-connection pool is rejected before reservation to prevent a self-inflicted wait. The worker sets `max: 2`. Although the installed postgres-js type declares reserved clients as `Sql`, its runtime reserved object lacks `begin`, so it cannot safely serve as the Drizzle transaction driver.

Lock acquisition uses a bounded PostgreSQL `lock_timeout` (two minutes by default, configurable from one millisecond to five minutes). The prior timeout is restored before returning the lease. Success and migration failure both unlock and release the reservation; failed cleanup closes the dedicated migration client so a potentially held session lock cannot remain in a reusable pool. The worker finally closes the client in all cases. The lock protects only callers using this helper or deliberately taking the identical key; independent manual migration clients are not automatically serialized.

`migration-lock.test.ts` checks failed acquisition, failed migration, failed unlock and unsafe pool sizing. The portfolio PostgreSQL suite additionally starts independent concurrent two-connection migration clients before legacy fixture creation and again before 0009, then verifies exactly one journal entry per migration. It exercises bounded contention and lock release after a failing SQL migration from a separate probe connection. Actual execution results remain in the verification record.
