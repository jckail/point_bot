-- Legacy/reference setup. Managed Drizzle migration 0008_agents_and_proposals now owns these tables.
-- Existing installations are adopted by that migration; new installations should run the journal.
-- Contains no OpenAI tokens. Transaction verifiers expire after ten minutes.
CREATE TABLE IF NOT EXISTS pointup_chatgpt_transactions (
  browser_id_hash text PRIMARY KEY,
  transaction_data jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pointup_chatgpt_transactions_expiry
  ON pointup_chatgpt_transactions (expires_at);
CREATE TABLE IF NOT EXISTS pointup_chatgpt_identities (
  issuer text NOT NULL,
  client_id text NOT NULL,
  subject text NOT NULL,
  clerk_user_id text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, client_id, subject),
  UNIQUE (issuer, client_id, clerk_user_id)
);

-- Protect these server-only tables from browser-accessible Supabase/PostgREST roles.
ALTER TABLE pointup_chatgpt_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pointup_chatgpt_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pointup_chatgpt_transactions, pointup_chatgpt_identities FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON pointup_chatgpt_transactions, pointup_chatgpt_identities FROM %I', browser_role);
    END IF;
  END LOOP;
END $$;
