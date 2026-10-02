-- Retain unknown historical provenance; do not fabricate credential/grant/snapshot identities.
CREATE UNIQUE INDEX "loyalty_account_id_user_provider_unique" ON "loyalty_account" USING btree ("id","user_id","provider_id");
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "provenance_version" smallint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "credential_kind" varchar(24);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "access_token_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "consent_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "consent_granted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "consent_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "skill_version" integer;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "source_method" varchar(24);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "capture_id" varchar(36);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "payload_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "baseline_snapshot_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "recorded_snapshot_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "review_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "review_decision" varchar(16);
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_owned_account_fk" FOREIGN KEY ("account_id","user_id","provider_id") REFERENCES "loyalty_account"("id","user_id","provider_id") ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_observation_owner_capture_unique" ON "agent_observation" USING btree ("user_id","capture_id") WHERE "agent_observation"."capture_id" is not null;
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_provenance_version_check" CHECK ("agent_observation"."provenance_version" IN (0, 1));
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_v1_provenance_check" CHECK ("agent_observation"."provenance_version" = 0 OR (
      "agent_observation"."credential_kind" IS NOT NULL AND "agent_observation"."credential_kind" IN ('session', 'clerk_bearer', 'personal_access_token') AND
      (("agent_observation"."credential_kind" = 'personal_access_token' AND "agent_observation"."access_token_id" IS NOT NULL) OR ("agent_observation"."credential_kind" <> 'personal_access_token' AND "agent_observation"."access_token_id" IS NULL)) AND
      "agent_observation"."consent_id" IS NOT NULL AND "agent_observation"."consent_granted_at" IS NOT NULL AND "agent_observation"."consent_expires_at" IS NOT NULL AND
      isfinite("agent_observation"."consent_granted_at") AND isfinite("agent_observation"."consent_expires_at") AND "agent_observation"."consent_expires_at" > "agent_observation"."consent_granted_at" AND
      "agent_observation"."created_at" >= "agent_observation"."consent_granted_at" AND "agent_observation"."created_at" < "agent_observation"."consent_expires_at" AND
      "agent_observation"."skill_version" IS NOT NULL AND "agent_observation"."skill_version" >= 0 AND
      "agent_observation"."source_method" IS NOT NULL AND "agent_observation"."source_method" IN ('page_capture', 'manual_entry', 'unknown') AND
      "agent_observation"."payload_hash" IS NOT NULL AND "agent_observation"."payload_hash" ~ '^[0-9a-f]{64}$' AND
      ("agent_observation"."capture_id" IS NULL OR "agent_observation"."capture_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    ));
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_v1_reading_check" CHECK ("agent_observation"."provenance_version" = 0 OR (
      "agent_observation"."points" BETWEEN 0 AND 9007199254740991 AND ("agent_observation"."previous_points" IS NULL OR "agent_observation"."previous_points" BETWEEN 0 AND 9007199254740991) AND
      "agent_observation"."outcome" IN ('recorded', 'unchanged', 'needs_review', 'rejected') AND
      isfinite("agent_observation"."observed_at") AND isfinite("agent_observation"."created_at") AND "agent_observation"."observed_at" <= "agent_observation"."created_at"
    ));
--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_v1_review_check" CHECK ("agent_observation"."provenance_version" = 0 OR (
      ("agent_observation"."review_expires_at" IS NULL OR (isfinite("agent_observation"."review_expires_at") AND "agent_observation"."review_expires_at" = "agent_observation"."created_at" + interval '24 hours')) AND
      ("agent_observation"."reviewed_at" IS NULL OR (isfinite("agent_observation"."reviewed_at") AND "agent_observation"."reviewed_at" >= "agent_observation"."created_at")) AND
      COALESCE(CASE "agent_observation"."outcome"
        WHEN 'needs_review' THEN "agent_observation"."review_expires_at" IS NOT NULL AND "agent_observation"."reviewed_at" IS NULL AND "agent_observation"."review_decision" IS NULL AND "agent_observation"."recorded_snapshot_id" IS NULL
        WHEN 'rejected' THEN "agent_observation"."review_expires_at" IS NOT NULL AND "agent_observation"."reviewed_at" IS NOT NULL AND "agent_observation"."review_decision" = 'reject' AND "agent_observation"."recorded_snapshot_id" IS NULL
        WHEN 'recorded' THEN "agent_observation"."recorded_snapshot_id" IS NOT NULL AND (
          ("agent_observation"."review_expires_at" IS NULL AND "agent_observation"."reviewed_at" IS NULL AND "agent_observation"."review_decision" IS NULL) OR
          ("agent_observation"."review_expires_at" IS NOT NULL AND "agent_observation"."reviewed_at" IS NOT NULL AND "agent_observation"."review_decision" = 'confirm' AND "agent_observation"."reviewed_at" < "agent_observation"."review_expires_at"))
        WHEN 'unchanged' THEN "agent_observation"."review_expires_at" IS NULL AND "agent_observation"."reviewed_at" IS NULL AND "agent_observation"."review_decision" IS NULL AND "agent_observation"."recorded_snapshot_id" IS NULL
        ELSE false
      END, false)
    ));
--> statement-breakpoint
-- Explicit deadline for legacy pending reviews, preserving existing IDs and outcomes.
UPDATE "agent_observation" SET "review_expires_at" = "created_at" + interval '24 hours'
WHERE "provenance_version" = 0 AND "outcome" = 'needs_review' AND isfinite("created_at");
-- Owned account FK is deliberately NOT VALID: existing mismatches remain retained
-- for inspection, while new/changed references must match account owner and provider.
-- Existing physical account-erasure cascade remains; retention purges no audit rows.
