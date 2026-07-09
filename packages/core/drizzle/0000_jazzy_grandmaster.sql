CREATE TABLE "balance_snapshot" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"loyalty_account_id" varchar(255) NOT NULL,
	"points" bigint NOT NULL,
	"source" varchar(16) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_account" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"membership_number" varchar(255) NOT NULL,
	"credential_ref" varchar(512),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_loyalty_account_id_loyalty_account_id_fk" FOREIGN KEY ("loyalty_account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshot_account_captured_idx" ON "balance_snapshot" USING btree ("loyalty_account_id","captured_at");--> statement-breakpoint
CREATE INDEX "loyalty_account_user_id_idx" ON "loyalty_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loyalty_account_user_provider_idx" ON "loyalty_account" USING btree ("user_id","provider_id");