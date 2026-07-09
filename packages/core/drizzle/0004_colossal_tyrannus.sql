CREATE TABLE "portfolio_share" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"label" varchar(80),
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "notes" varchar(2000);--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "tags" varchar(512) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "portfolio_share_user_id_idx" ON "portfolio_share" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_share_token_unique" ON "portfolio_share" USING btree ("token");--> statement-breakpoint
CREATE INDEX "loyalty_account_deleted_at_idx" ON "loyalty_account" USING btree ("deleted_at");