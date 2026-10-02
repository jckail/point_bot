-- Index proposals validated against the scratch benchmark database (app_bench).
-- #1-#3 now ship as migration 0015_perf_indexes (plus activity_event_occurred_idx
-- for the retention purge, and the drops of domain_event_outbox_pending_idx and
-- loyalty_account_user_id_idx); this file stays as the standalone way to apply
-- them to a bench database that predates the migration. See docs/performance.md
-- (section 5 and 10.3) for the measured effect and the rationale.
--
--   psql postgresql://postgres:password@localhost:5432/app_bench -f scripts/bench/proposed-indexes.sql
--
-- In production create with CONCURRENTLY (cannot run inside a transaction block,
-- so each statement is its own migration step / `-c` call).

-- 1. Outbox poll: match the claim query's full ORDER BY (available_at,
--    occurred_at, id) so the planner can stop after `limit` rows instead of an
--    incremental sort over every row sharing a leading key. Replaces
--    domain_event_outbox_pending_idx.
CREATE INDEX IF NOT EXISTS domain_event_outbox_claim_idx
  ON domain_event_outbox (available_at, occurred_at, id)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

-- 2. Outbox retention: lets a purge job delete processed rows by age without a
--    sequential scan (processed rows are excluded from the pending indexes).
CREATE INDEX IF NOT EXISTS domain_event_outbox_processed_idx
  ON domain_event_outbox (processed_at)
  WHERE processed_at IS NOT NULL;

-- 3. Worker fan-out start (`listUserIds`: DISTINCT user_id over active
--    accounts): a partial index gives an ordered, index-only unique scan.
CREATE INDEX IF NOT EXISTS loyalty_account_active_user_idx
  ON loyalty_account (user_id)
  WHERE deleted_at IS NULL;

-- 4. EVALUATED AND REJECTED: (loyalty_account_id, captured_at DESC, id DESC)
--    INCLUDE (points, source) on balance_snapshot. The trend/latest probes are
--    already 4 index probes per account (~0.7 ms for 25 accounts); the new
--    index changed buffer hits 401 -> 406 and time by <0.2 ms while adding
--    ~250 MB per 3.7M rows. Not worth the write amplification.
