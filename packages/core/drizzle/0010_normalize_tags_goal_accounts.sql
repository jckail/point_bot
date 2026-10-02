CREATE TABLE "account_tag" (
	"account_id" varchar(255) NOT NULL,
	"tag" varchar(64) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "account_tag_account_id_tag_pk" PRIMARY KEY("account_id","tag")
);
--> statement-breakpoint
CREATE TABLE "trip_goal_account" (
	"goal_id" varchar(255) NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "trip_goal_account_goal_id_account_id_pk" PRIMARY KEY("goal_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "account_tag" ADD CONSTRAINT "account_tag_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_goal_account" ADD CONSTRAINT "trip_goal_account_goal_id_trip_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."trip_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_goal_account" ADD CONSTRAINT "trip_goal_account_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_tag_tag_idx" ON "account_tag" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "trip_goal_account_account_idx" ON "trip_goal_account" USING btree ("account_id");--> statement-breakpoint
-- Data migration: explode the comma-separated columns into the join tables
-- (order preserved via ordinality; blanks/duplicates dropped; goal links to
-- accounts that no longer exist are dropped since they now carry an FK).
INSERT INTO "account_tag" ("account_id", "tag", "position")
SELECT "account_id", "tag", (row_number() OVER (PARTITION BY "account_id" ORDER BY "ord") - 1)::integer
FROM (
	SELECT DISTINCT ON (a."id", btrim(t.tag))
		a."id" AS "account_id", left(btrim(t.tag), 64) AS "tag", t.ord AS "ord"
	FROM "loyalty_account" a
	CROSS JOIN LATERAL unnest(string_to_array(a."tags", ',')) WITH ORDINALITY AS t(tag, ord)
	WHERE btrim(t.tag) <> ''
	ORDER BY a."id", btrim(t.tag), t.ord
) dedup
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "trip_goal_account" ("goal_id", "account_id", "position")
SELECT "goal_id", "account_id", (row_number() OVER (PARTITION BY "goal_id" ORDER BY "ord") - 1)::integer
FROM (
	SELECT DISTINCT ON (g."id", btrim(t.account_id))
		g."id" AS "goal_id", btrim(t.account_id) AS "account_id", t.ord AS "ord"
	FROM "trip_goal" g
	CROSS JOIN LATERAL unnest(string_to_array(g."account_ids", ',')) WITH ORDINALITY AS t(account_id, ord)
	JOIN "loyalty_account" a ON a."id" = btrim(t.account_id)
	WHERE btrim(t.account_id) <> ''
	ORDER BY g."id", btrim(t.account_id), t.ord
) dedup
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Clean up dangling references before adding the new foreign keys.
UPDATE "activity_event" SET "account_id" = NULL
WHERE "account_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "loyalty_account" a WHERE a."id" = "activity_event"."account_id");--> statement-breakpoint
DELETE FROM "agent_observation"
WHERE NOT EXISTS (SELECT 1 FROM "loyalty_account" a WHERE a."id" = "agent_observation"."account_id");--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observation" ADD CONSTRAINT "agent_observation_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_account" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "trip_goal" DROP COLUMN "account_ids";