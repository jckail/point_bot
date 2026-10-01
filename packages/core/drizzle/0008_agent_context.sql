CREATE TABLE "access_token" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(80) NOT NULL,
	"display_prefix" varchar(16) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"scopes" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_observation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"skill_id" varchar(96) NOT NULL,
	"agent" varchar(64) NOT NULL,
	"source_host" varchar(255) NOT NULL,
	"points" bigint NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_grant" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "access_token_user_id_idx" ON "access_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_hash_unique" ON "access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_observation_user_created_idx" ON "agent_observation" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_grant_user_id_idx" ON "consent_grant" USING btree ("user_id");