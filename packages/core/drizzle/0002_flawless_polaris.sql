CREATE TABLE "activity_event" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"type" varchar(32) NOT NULL,
	"account_id" varchar(255),
	"provider_id" varchar(64),
	"summary" varchar(512) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "activity_event_user_occurred_idx" ON "activity_event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "loyalty_account_expires_at_idx" ON "loyalty_account" USING btree ("expires_at");