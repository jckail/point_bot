CREATE TABLE "domain_event_outbox" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" varchar(255),
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"last_error" varchar(1000)
);
--> statement-breakpoint
CREATE INDEX "domain_event_outbox_pending_idx" ON "domain_event_outbox" USING btree ("available_at","occurred_at") WHERE "domain_event_outbox"."processed_at" is null and "domain_event_outbox"."dead_lettered_at" is null;--> statement-breakpoint
CREATE INDEX "domain_event_outbox_aggregate_idx" ON "domain_event_outbox" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX "domain_event_outbox_user_idx" ON "domain_event_outbox" USING btree ("user_id","occurred_at");--> statement-breakpoint
-- Same posture as 0009/0011: RLS on, no policies, so PostgREST/GraphQL on
-- Supabase can never read or write the outbox (payloads carry user ids).
ALTER TABLE "domain_event_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "domain_event_outbox" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "domain_event_outbox" FROM authenticated;
  END IF;
END $$;
