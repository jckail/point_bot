-- Adopt the standalone server-only SIWC tables without deleting existing links
-- or in-flight browser transactions. Drizzle executes this migration atomically.
CREATE TABLE IF NOT EXISTS "pointup_chatgpt_transactions" (
  "browser_id_hash" text PRIMARY KEY NOT NULL,
  "transaction_data" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pointup_chatgpt_identities" (
  "issuer" text NOT NULL,
  "client_id" text NOT NULL,
  "subject" text NOT NULL,
  "clerk_user_id" text NOT NULL,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("issuer", "client_id", "subject"),
  UNIQUE ("issuer", "client_id", "clerk_user_id")
);
--> statement-breakpoint
-- Block concurrent writes/DDL while inspecting adopted storage.
LOCK TABLE "pointup_chatgpt_transactions", "pointup_chatgpt_identities" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- IF NOT EXISTS alone cannot establish that an operator's pre-existing table
-- has the required shape or identity guarantees. Refuse incompatible adoption.
DO $$
DECLARE
  expected record;
  table_oid oid;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('pointup_chatgpt_transactions', 'browser_id_hash', 'text'),
    ('pointup_chatgpt_transactions', 'transaction_data', 'jsonb'),
    ('pointup_chatgpt_transactions', 'expires_at', 'timestamp with time zone'),
    ('pointup_chatgpt_identities', 'issuer', 'text'),
    ('pointup_chatgpt_identities', 'client_id', 'text'),
    ('pointup_chatgpt_identities', 'subject', 'text'),
    ('pointup_chatgpt_identities', 'clerk_user_id', 'text'),
    ('pointup_chatgpt_identities', 'linked_at', 'timestamp with time zone')
  ) AS shape(table_name, column_name, type_name) LOOP
    table_oid := to_regclass(format('%I.%I', current_schema(), expected.table_name));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = table_oid AND relkind = 'r')
      OR NOT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = table_oid AND attname = expected.column_name
          AND NOT attisdropped AND attnotnull
          AND atttypid = expected.type_name::regtype AND atttypmod = -1) THEN
      RAISE EXCEPTION 'Incompatible SIWC storage: %.% must have the expected nonnullable type', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('pointup_chatgpt_transactions', 3), ('pointup_chatgpt_identities', 5)
  ) AS shape(table_name, column_count) LOOP
    table_oid := to_regclass(format('%I.%I', current_schema(), expected.table_name));
    IF (SELECT count(*) FROM pg_attribute WHERE attrelid = table_oid AND attnum > 0 AND NOT attisdropped) <> expected.column_count THEN
      RAISE EXCEPTION 'Incompatible SIWC storage: % has unexpected columns', expected.table_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('pointup_chatgpt_transactions', 'p', ARRAY['browser_id_hash']::text[]),
    ('pointup_chatgpt_identities', 'p', ARRAY['issuer', 'client_id', 'subject']::text[]),
    ('pointup_chatgpt_identities', 'u', ARRAY['issuer', 'client_id', 'clerk_user_id']::text[])
  ) AS shape(table_name, constraint_type, expected_columns) LOOP
    table_oid := to_regclass(format('%I.%I', current_schema(), expected.table_name));
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = table_oid AND c.contype::text = expected.constraint_type
        AND c.convalidated AND NOT c.condeferrable
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = table_oid AND a.attnum = k.attnum ORDER BY k.position) = expected.expected_columns
    ) THEN
      RAISE EXCEPTION 'Incompatible SIWC storage: % lacks the required immediate identity constraint', expected.table_name;
    END IF;
  END LOOP;
  table_oid := to_regclass(format('%I.pointup_chatgpt_identities', current_schema()));
  IF NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = table_oid AND a.attname = 'linked_at'
      AND lower(pg_get_expr(d.adbin, d.adrelid)) IN ('now()', 'current_timestamp')) THEN
    RAISE EXCEPTION 'Incompatible SIWC storage: linked_at requires its current-time default';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pointup_chatgpt_transactions_expiry" ON "pointup_chatgpt_transactions" ("expires_at");
--> statement-breakpoint
ALTER TABLE "pointup_chatgpt_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pointup_chatgpt_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "pointup_chatgpt_transactions", "pointup_chatgpt_identities" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "pointup_chatgpt_transactions", "pointup_chatgpt_identities" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "pointup_chatgpt_transactions", "pointup_chatgpt_identities" FROM authenticated;
  END IF;
END $$;
