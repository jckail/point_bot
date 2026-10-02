-- Preserve historical rows exactly. NOT VALID enforces future writes without
-- pretending old values passed validation. Inspect exact SQL integer text and
-- explicitly repair each invalid row before validating a named constraint.
-- Requires the managed migration transaction; fail on contention for a later
-- deliberate retry instead of waiting indefinitely during deployment.
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_points_check" CHECK ("balance_snapshot"."points" BETWEEN 0 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_source_check" CHECK ("balance_snapshot"."source" IN ('sync', 'manual', 'agent')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "trip_goal" ADD CONSTRAINT "trip_goal_target_points_check" CHECK ("trip_goal"."target_points" BETWEEN 1 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "trip_goal" ADD CONSTRAINT "trip_goal_status_check" CHECK ("trip_goal"."status" IN ('active', 'achieved', 'archived')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "user_provider_valuation" ADD CONSTRAINT "user_provider_valuation_milli_check" CHECK ("user_provider_valuation"."cents_per_point_milli" BETWEEN 1 AND 100000) NOT VALID;
--> statement-breakpoint
ALTER TABLE "award_watch" ADD CONSTRAINT "award_watch_threshold_milli_check" CHECK ("award_watch"."min_cents_per_point_milli" BETWEEN 1 AND 100000) NOT VALID;
--> statement-breakpoint
ALTER TABLE "award_watch" ADD CONSTRAINT "award_watch_best_milli_check" CHECK ("award_watch"."best_seen_cents_per_point_milli" IS NULL OR "award_watch"."best_seen_cents_per_point_milli" >= 0) NOT VALID;
