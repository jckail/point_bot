-- Supabase exposes every table in the `public` schema through PostgREST using
-- the `anon` / `authenticated` roles. PointUp's data is only ever accessed by
-- the server over a direct Postgres connection (which bypasses RLS), so we
-- enable RLS with NO policies: the auto-generated REST/GraphQL API can never
-- read or write these tables, even if an anon key leaks. This is a no-op for
-- local Postgres and AWS RDS.
ALTER TABLE "loyalty_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "balance_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_goal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_provider_valuation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "award_watch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
