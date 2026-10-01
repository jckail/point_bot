-- Index changes verified on the scratch benchmark database (docs/performance.md,
-- scripts/bench/proposed-indexes.sql). Plain CREATE INDEX on purpose: drizzle
-- runs each migration in a transaction and CREATE INDEX CONCURRENTLY cannot run
-- inside one. These tables are small to medium and the lock is short, but on a
-- very large production table create the index by hand with CONCURRENTLY first
-- (same name, IF NOT EXISTS is not used here, so drop the manual one or mark the
-- migration applied) and then run this migration.
-- New indexes are created before the old ones are dropped.
-- Retention purge by age across all users (activity_event_user_occurred_idx cannot serve it).
CREATE INDEX "activity_event_occurred_idx" ON "activity_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "domain_event_outbox_claim_idx" ON "domain_event_outbox" USING btree ("available_at","occurred_at","id") WHERE "domain_event_outbox"."processed_at" is null and "domain_event_outbox"."dead_lettered_at" is null;--> statement-breakpoint
CREATE INDEX "domain_event_outbox_processed_idx" ON "domain_event_outbox" USING btree ("processed_at") WHERE "domain_event_outbox"."processed_at" is not null;--> statement-breakpoint
CREATE INDEX "loyalty_account_active_user_idx" ON "loyalty_account" USING btree ("user_id") WHERE "loyalty_account"."deleted_at" is null;--> statement-breakpoint
-- Superseded: the claim index has the same predicate and a superset of columns.
DROP INDEX "domain_event_outbox_pending_idx";--> statement-breakpoint
-- Redundant: strict prefix of loyalty_account_user_provider_unique (user_id, provider_id).
DROP INDEX "loyalty_account_user_id_idx";
