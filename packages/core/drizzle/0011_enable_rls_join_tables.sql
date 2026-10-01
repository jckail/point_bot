-- Same posture as 0009: RLS on, no policies, so PostgREST/GraphQL on Supabase
-- can never read or write the join tables added in 0010.
ALTER TABLE "account_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_goal_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "account_tag", "trip_goal_account" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "account_tag", "trip_goal_account" FROM authenticated;
  END IF;
END $$;
