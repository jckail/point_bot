CREATE TABLE "award_watch" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"label" varchar(120) NOT NULL,
	"min_cents_per_point_milli" integer NOT NULL,
	"best_seen_cents_per_point_milli" integer,
	"last_checked_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "award_watch_user_id_idx" ON "award_watch" USING btree ("user_id");