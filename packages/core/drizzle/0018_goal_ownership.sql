-- PR14's normalized membership and its existing positions remain canonical.
-- Quarantine before backfill: never invent an owner for a missing parent, or
-- turn a foreign account into an owned membership. Exact original row JSON is
-- retained without a parent FK so later deletion cannot destroy the evidence.
CREATE TABLE "trip_goal_membership_review" (
  "goal_id" varchar(255) NOT NULL,
  "account_id" varchar(255) NOT NULL,
  "goal_owner_id" varchar(255),
  "account_owner_id" varchar(255),
  "reason" varchar(64) NOT NULL,
  "original_row" jsonb NOT NULL,
  "provenance" varchar(128) NOT NULL,
  "quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trip_goal_membership_review_goal_id_account_id_pk" PRIMARY KEY ("goal_id", "account_id")
);
--> statement-breakpoint
-- Run inside the managed migration transaction. Fail rather than wait forever
-- for live writers; a lock timeout rolls back the migration for later retry.
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
-- Stabilize both membership rows and authoritative parent owners before the
-- archive/delete/backfill sequence. A transaction alone permits new inserts
-- between its archive SELECT and DELETE, which would lose forensic evidence.
LOCK TABLE trip_goal_account, trip_goal, loyalty_account IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO trip_goal_membership_review (goal_id, account_id, goal_owner_id, account_owner_id, reason, original_row, provenance)
SELECT m.goal_id, m.account_id, g.user_id, a.user_id,
  CASE WHEN g.id IS NULL THEN 'missing_goal' WHEN a.id IS NULL THEN 'missing_account' ELSE 'different_owner' END,
  to_jsonb(m), '0018_goal_ownership:trip_goal_account'
FROM trip_goal_account m
LEFT JOIN trip_goal g ON g.id = m.goal_id
LEFT JOIN loyalty_account a ON a.id = m.account_id
WHERE g.id IS NULL OR a.id IS NULL OR a.user_id <> g.user_id;
--> statement-breakpoint
DELETE FROM trip_goal_account m
WHERE NOT EXISTS (
  SELECT 1 FROM trip_goal g JOIN loyalty_account a ON a.user_id = g.user_id
  WHERE g.id = m.goal_id AND a.id = m.account_id
);
--> statement-breakpoint
ALTER TABLE trip_goal_account ADD COLUMN user_id varchar(255);
--> statement-breakpoint
UPDATE trip_goal_account m SET user_id = g.user_id FROM trip_goal g WHERE g.id = m.goal_id;
--> statement-breakpoint
ALTER TABLE trip_goal_account ALTER COLUMN user_id SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_id_user_unique" ON "loyalty_account" ("id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_goal_id_user_unique" ON "trip_goal" ("id", "user_id");
--> statement-breakpoint
ALTER TABLE trip_goal_account DROP CONSTRAINT "trip_goal_account_goal_id_trip_goal_id_fk";
--> statement-breakpoint
ALTER TABLE trip_goal_account DROP CONSTRAINT "trip_goal_account_account_id_loyalty_account_id_fk";
--> statement-breakpoint
ALTER TABLE trip_goal_account ADD CONSTRAINT "trip_goal_account_owned_goal_fk" FOREIGN KEY (goal_id, user_id) REFERENCES trip_goal (id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE trip_goal_account ADD CONSTRAINT "trip_goal_account_owned_account_fk" FOREIGN KEY (account_id, user_id) REFERENCES loyalty_account (id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
-- Mixed-rollout compatibility: old hosts omit user_id. Derive only a NULL
-- value from the authoritative goal; an explicit owner is never overwritten.
-- Composite FKs still reject foreign accounts and mismatched explicit owners.
-- Resolve the parent in the trigger table's schema, not caller search_path.
CREATE FUNCTION pointup_derive_goal_membership_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    EXECUTE format('SELECT user_id FROM %I.trip_goal WHERE id = $1', TG_TABLE_SCHEMA)
      INTO NEW.user_id USING NEW.goal_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trip_goal_account_derive_owner BEFORE INSERT OR UPDATE ON trip_goal_account
FOR EACH ROW EXECUTE FUNCTION pointup_derive_goal_membership_owner();
--> statement-breakpoint
ALTER TABLE trip_goal_account ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE trip_goal_membership_review ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON trip_goal_account, trip_goal_membership_review FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON trip_goal_account, trip_goal_membership_review FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON trip_goal_account, trip_goal_membership_review FROM authenticated;
  END IF;
END $$;
