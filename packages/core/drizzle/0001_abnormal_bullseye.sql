DROP INDEX "loyalty_account_user_provider_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_user_provider_unique" ON "loyalty_account" USING btree ("user_id","provider_id");