CREATE TABLE "transfer_bonus" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"from_provider_id" varchar(64) NOT NULL,
	"to_provider_id" varchar(64) NOT NULL,
	"multiplier_permille" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_url" varchar(2048),
	"verified_at" timestamp with time zone,
	"created_by" varchar(255),
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transfer_bonus_multiplier_range" CHECK ("transfer_bonus"."multiplier_permille" > 1000 and "transfer_bonus"."multiplier_permille" <= 3000),
	CONSTRAINT "transfer_bonus_window_order" CHECK ("transfer_bonus"."ends_at" > "transfer_bonus"."starts_at")
);
--> statement-breakpoint
CREATE INDEX "transfer_bonus_window_idx" ON "transfer_bonus" USING btree ("ends_at","starts_at");--> statement-breakpoint
CREATE INDEX "transfer_bonus_edge_idx" ON "transfer_bonus" USING btree ("from_provider_id","to_provider_id");--> statement-breakpoint
-- Same posture as 0009/0011/0013: RLS on, no policies, so PostgREST/GraphQL on
-- Supabase can never read or write bonuses directly (the app connects as owner).
ALTER TABLE "transfer_bonus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "transfer_bonus" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "transfer_bonus" FROM authenticated;
  END IF;
END $$;
