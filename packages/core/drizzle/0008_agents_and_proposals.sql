CREATE TABLE "agent_observation" (
	"id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token_id" varchar(255) NOT NULL,
	"consent_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"points" bigint NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"source_host" varchar(255) NOT NULL,
	"source_method" varchar(32) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"hold_reason" varchar(255),
	"created_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"snapshot_id" varchar(255),
	CONSTRAINT "agent_observation_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "agent_observation_points_check" CHECK ("agent_observation"."points" >= 0 AND "agent_observation"."points" <= 9007199254740991),
	CONSTRAINT "agent_observation_status_check" CHECK ("agent_observation"."status" IN ('accepted', 'held', 'rejected')),
	CONSTRAINT "agent_observation_method_check" CHECK ("agent_observation"."source_method" IN ('page_capture', 'manual_entry'))
);
--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "agent_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_token" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(80) NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "agent_token_expiry_check" CHECK ("agent_token"."expires_at" > "agent_token"."created_at" AND "agent_token"."expires_at" <= "agent_token"."created_at" + interval '90 days'),
	CONSTRAINT "agent_token_hash_check" CHECK ("agent_token"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_token_scopes_check" CHECK (jsonb_typeof("agent_token"."scopes") = 'array' AND jsonb_array_length("agent_token"."scopes") > 0 AND "agent_token"."scopes" <@ '["portfolio:read","portfolio:write","observations:write","sync:execute","shares:write","assistant:chat","actions:propose"]'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "agent_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	CONSTRAINT "assistant_action_kind_check" CHECK ("assistant_action"."kind" IN ('manual_balance', 'trip_goal')),
	CONSTRAINT "assistant_action_status_check" CHECK ("assistant_action"."status" IN ('pending', 'executing', 'succeeded', 'rejected', 'expired', 'failed', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "assistant_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pointup_chatgpt_identities" (
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"subject" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pointup_chatgpt_identities_pkey" PRIMARY KEY("issuer","client_id","subject"),
	CONSTRAINT "pointup_chatgpt_identities_issuer_client_id_clerk_user_id_key" UNIQUE("issuer","client_id","clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "pointup_chatgpt_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pointup_chatgpt_transactions" (
	"browser_id_hash" text PRIMARY KEY NOT NULL,
	"transaction_data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pointup_chatgpt_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "observation_consent" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "observation_consent_expiry_check" CHECK ("observation_consent"."expires_at" > "observation_consent"."granted_at" AND "observation_consent"."expires_at" <= "observation_consent"."granted_at" + interval '30 days')
);
--> statement-breakpoint
ALTER TABLE "observation_consent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_id_user_unique" ON "agent_token" USING btree ("id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "observation_consent_identity_unique" ON "observation_consent" USING btree ("id","user_id","account_id","provider_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_id_user_provider_unique" ON "loyalty_account" USING btree ("id","user_id","provider_id");
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_snapshot_id_balance_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."balance_snapshot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_owned_token_fk" FOREIGN KEY ("token_id","user_id") REFERENCES "public"."agent_token"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_owned_consent_fk" FOREIGN KEY ("consent_id","user_id","account_id","provider_id") REFERENCES "public"."observation_consent"("id","user_id","account_id","provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_consent" ADD CONSTRAINT "observation_consent_owned_account_fk" FOREIGN KEY ("account_id","user_id","provider_id") REFERENCES "public"."loyalty_account"("id","user_id","provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_observation_user_status_idx" ON "agent_observation" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_hash_unique" ON "agent_token" USING btree ("token_hash");--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "agent_token_user_idx" ON "agent_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assistant_action_user_status_idx" ON "assistant_action" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pointup_chatgpt_transactions_expiry" ON "pointup_chatgpt_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "observation_consent_user_account_idx" ON "observation_consent" USING btree ("user_id","account_id");--> statement-breakpoint
--> statement-breakpoint

--> statement-breakpoint
REVOKE ALL ON "agent_token", "observation_consent", "agent_observation", "assistant_action", "pointup_chatgpt_transactions", "pointup_chatgpt_identities" FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON agent_token, observation_consent, agent_observation, assistant_action, pointup_chatgpt_transactions, pointup_chatgpt_identities FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
