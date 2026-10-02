-- Apply before deploying capture/review writers. No retained data is rewritten.
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "account_identity_witness" jsonb;
-- Existing RLS and ownership constraints are unchanged. NULL or malformed
-- identity evidence is rejected by the server confirmation guard; rejection remains available.
