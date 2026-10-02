CREATE TABLE "trip_goal_account" (
	"goal_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"loyalty_account_id" varchar(255) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "trip_goal_account_goal_id_loyalty_account_id_pk" PRIMARY KEY("goal_id","loyalty_account_id"),
	CONSTRAINT "trip_goal_account_position_check" CHECK ("trip_goal_account"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trip_goal_membership_review" (
	"goal_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"account_id" text NOT NULL,
	"reason" text NOT NULL,
	"legacy_account_ids" text NOT NULL,
	CONSTRAINT "trip_goal_membership_review_goal_id_account_id_pk" PRIMARY KEY("goal_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "trip_goal" ALTER COLUMN "account_ids" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "loyalty_account" ALTER COLUMN "tags" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "loyalty_account" ALTER COLUMN "tags" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD COLUMN "tag_values" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_id_user_unique" ON "loyalty_account" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_goal_id_user_unique" ON "trip_goal" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "trip_goal_account" ADD CONSTRAINT "trip_goal_account_owned_goal_fk" FOREIGN KEY ("goal_id","user_id") REFERENCES "public"."trip_goal"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_goal_account" ADD CONSTRAINT "trip_goal_account_owned_account_fk" FOREIGN KEY ("loyalty_account_id","user_id") REFERENCES "public"."loyalty_account"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Archive invalid legacy strings for operator review and repair old-host
-- compatibility projections. Canonical reads use the tenant-qualified relation.
UPDATE "loyalty_account" SET "tag_values" = ARRAY(
  SELECT btrim(value) FROM unnest(string_to_array(tags, ',')) WITH ORDINALITY AS tag(value, ordinal)
  WHERE btrim(value) <> '' ORDER BY ordinal
);
--> statement-breakpoint
INSERT INTO "trip_goal_membership_review" (goal_id, user_id, account_id, reason, legacy_account_ids)
SELECT DISTINCT g.id, g.user_id, btrim(link.account_id),
  CASE WHEN a.id IS NULL THEN 'missing_account' ELSE 'different_owner' END, g.account_ids
FROM trip_goal g
CROSS JOIN LATERAL unnest(string_to_array(g.account_ids, ',')) AS link(account_id)
LEFT JOIN loyalty_account a ON a.id = btrim(link.account_id)
WHERE btrim(link.account_id) <> '' AND (a.id IS NULL OR a.user_id <> g.user_id);
--> statement-breakpoint
INSERT INTO "trip_goal_account" (goal_id, user_id, loyalty_account_id, position)
SELECT g.id, g.user_id, a.id, (min(link.ordinal) - 1)::integer
FROM trip_goal g
CROSS JOIN LATERAL unnest(string_to_array(g.account_ids, ',')) WITH ORDINALITY AS link(account_id, ordinal)
JOIN loyalty_account a ON a.id = btrim(link.account_id) AND a.user_id = g.user_id
GROUP BY g.id, g.user_id, a.id;
--> statement-breakpoint
-- Repair the compatibility projection before old hosts can read it. Exact
-- original invalid CSV remains in the server-only review rows above.
UPDATE trip_goal g SET account_ids = COALESCE((
  SELECT string_agg(m.loyalty_account_id, ',' ORDER BY m.position, m.loyalty_account_id)
  FROM trip_goal_account m WHERE m.goal_id = g.id AND m.user_id = g.user_id
), '');
--> statement-breakpoint
-- Synchronize old-host tag writes, while explicit array writers retain commas
-- inside a tag without splitting them. No domain-valid tag is truncated.
CREATE FUNCTION pointup_sync_tags() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tag_values <> ARRAY[]::text[] THEN
      NEW.tags := array_to_string(NEW.tag_values, ',');
    ELSIF NEW.tags <> '' THEN
      NEW.tag_values := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(NEW.tags, ',')) AS t(value) WHERE btrim(value) <> '');
    END IF;
  ELSIF NEW.tag_values IS DISTINCT FROM OLD.tag_values THEN
    NEW.tags := array_to_string(NEW.tag_values, ',');
  ELSIF NEW.tags IS DISTINCT FROM OLD.tags THEN
    NEW.tag_values := ARRAY(SELECT btrim(value) FROM unnest(string_to_array(NEW.tags, ',')) AS t(value) WHERE btrim(value) <> '');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER loyalty_account_sync_tags BEFORE INSERT OR UPDATE OF tags, tag_values ON loyalty_account
FOR EACH ROW EXECUTE FUNCTION pointup_sync_tags();
--> statement-breakpoint
-- Parent writes and membership replacement are one atomic PostgreSQL statement.
-- Row locks on the parent serialize concurrent updates. Composite FKs remain
-- the authority even for direct writes to the relation.
CREATE FUNCTION pointup_sync_goal_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_ids IS NOT DISTINCT FROM OLD.account_ids
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(string_to_array(NEW.account_ids, ',')) AS link(account_id)
    LEFT JOIN loyalty_account a ON a.id = btrim(link.account_id) AND a.user_id = NEW.user_id AND a.deleted_at IS NULL
    WHERE btrim(link.account_id) <> '' AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Goal references an unavailable owned account' USING ERRCODE = '23503', CONSTRAINT = 'trip_goal_account_owned_account_fk';
  END IF;
  DELETE FROM trip_goal_account WHERE goal_id = NEW.id;
  INSERT INTO trip_goal_account (goal_id, user_id, loyalty_account_id, position)
  SELECT NEW.id, NEW.user_id, btrim(account_id), (min(ordinal) - 1)::integer
  FROM unnest(string_to_array(NEW.account_ids, ',')) WITH ORDINALITY AS link(account_id, ordinal)
  WHERE btrim(account_id) <> '' GROUP BY btrim(account_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trip_goal_sync_accounts AFTER INSERT OR UPDATE OF account_ids, user_id ON trip_goal
FOR EACH ROW EXECUTE FUNCTION pointup_sync_goal_accounts();
--> statement-breakpoint
ALTER TABLE trip_goal_membership_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trip_goal_membership_review FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_points_check" CHECK ("balance_snapshot"."points" >= 0 AND "balance_snapshot"."points" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_source_check" CHECK ("balance_snapshot"."source" IN ('sync', 'manual')) NOT VALID;--> statement-breakpoint
ALTER TABLE "trip_goal" ADD CONSTRAINT "trip_goal_target_points_check" CHECK ("trip_goal"."target_points" > 0 AND "trip_goal"."target_points" <= 9007199254740991) NOT VALID;--> statement-breakpoint
ALTER TABLE "trip_goal" ADD CONSTRAINT "trip_goal_status_check" CHECK ("trip_goal"."status" IN ('active', 'achieved', 'archived')) NOT VALID;
