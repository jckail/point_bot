-- Existing duplicate open grants (from the old non-atomic grant) would block the
-- unique index: keep only the newest open grant per (user, provider).
UPDATE "consent_grant" c SET "revoked_at" = now()
WHERE c."revoked_at" IS NULL AND EXISTS (
  SELECT 1 FROM "consent_grant" n
  WHERE n."user_id" = c."user_id" AND n."provider_id" = c."provider_id"
    AND n."revoked_at" IS NULL
    AND (n."granted_at" > c."granted_at" OR (n."granted_at" = c."granted_at" AND n."id" > c."id"))
);--> statement-breakpoint
ALTER TABLE "agent_observation" ADD COLUMN "previous_points" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_grant_one_open" ON "consent_grant" USING btree ("user_id","provider_id") WHERE "consent_grant"."revoked_at" is null;
