CREATE TABLE "trip_goal" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(120) NOT NULL,
	"target_points" bigint NOT NULL,
	"target_date" varchar(10),
	"account_ids" varchar(2048) DEFAULT '' NOT NULL,
	"status" varchar(16) NOT NULL,
	"notes" varchar(2000),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trip_goal_user_id_idx" ON "trip_goal" USING btree ("user_id");