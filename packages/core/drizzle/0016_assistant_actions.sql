CREATE TABLE "assistant_action" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(16) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "result" jsonb,
  "failure_code" varchar(64),
  CONSTRAINT "assistant_action_kind_check" CHECK ("kind" IN ('manual_balance', 'trip_goal')),
  CONSTRAINT "assistant_action_status_check" CHECK ("status" IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'failed', 'unknown')),
  CONSTRAINT "assistant_action_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "assistant_action_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "assistant_action_user_status_idx" ON "assistant_action" ("user_id", "status");
--> statement-breakpoint
ALTER TABLE "assistant_action" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "assistant_action" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "assistant_action" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "assistant_action" FROM authenticated;
  END IF;
END $$;
