import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ownedSchema = /^pointup_siwc_fixture_[a-f0-9]{32}$/;
const migrationPath = new URL("../drizzle/0017_chatgpt_identity.sql", import.meta.url);
const transactionTable = `CREATE TABLE pointup_chatgpt_transactions (
  browser_id_hash text PRIMARY KEY, transaction_data jsonb NOT NULL, expires_at timestamptz NOT NULL
)`;
const identityTable = `CREATE TABLE pointup_chatgpt_identities (
  issuer text NOT NULL, client_id text NOT NULL, subject text NOT NULL,
  clerk_user_id text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, client_id, subject), UNIQUE (issuer, client_id, clerk_user_id)
)`;

suite("managed SIWC migration on dedicated isolated PostgreSQL schemas", () => {
  let sql: Sql;
  let migration: string;
  const schemas: string[] = [];

  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("SIWC migration tests require the dedicated loopback postgres/app fixture.");
    }
    migration = await readFile(migrationPath, "utf8");
    sql = postgres(url!, { max: 2, connect_timeout: 10, onnotice: () => {} });
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const schema of schemas) {
        if (!ownedSchema.test(schema)) throw new Error("Refusing to remove an unowned SIWC fixture schema.");
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally { await sql.end({ timeout: 5 }); }
  });

  async function fixture(statements: string[] = []) {
    const schema = `pointup_siwc_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const statement of statements) await tx.unsafe(statement);
    });
    return schema;
  }

  async function apply(schema: string) {
    await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.unsafe(statement);
      }
    });
  }

  async function assertProtected(schema: string) {
    const rows = await sql`SELECT c.relname, c.relrowsecurity,
      NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        LEFT JOIN pg_roles r ON r.oid = a.grantee WHERE a.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AS browser_revoked
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname IN ('pointup_chatgpt_transactions', 'pointup_chatgpt_identities')`;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, browser_revoked: true });
  }

  it("creates protected tables from empty storage and can repeat adoption", async () => {
    const schema = await fixture();
    await apply(schema);
    await apply(schema);
    await assertProtected(schema);
    await sql.unsafe(`INSERT INTO "${schema}".pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id) VALUES ('fixture', 'client', 'subject', 'owner')`);
    const rows = await sql.unsafe(`SELECT linked_at FROM "${schema}".pointup_chatgpt_identities`);
    expect(rows[0]?.linked_at).toBeInstanceOf(Date);
    await expect(sql.unsafe(`INSERT INTO "${schema}".pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id) VALUES ('fixture', 'client', 'other-subject', 'owner')`)).rejects.toMatchObject({ code: "23505" });
  });

  it("adopts legacy standalone tables without changing transactions or identity links", async () => {
    const schema = await fixture([transactionTable, identityTable,
      `INSERT INTO pointup_chatgpt_transactions VALUES ('fixture-hash', '{"marker":"synthetic"}', '2030-01-01T00:00:00Z')`,
      `INSERT INTO pointup_chatgpt_identities VALUES ('fixture', 'client', 'subject', 'owner', '2026-01-01T00:00:00Z')`,
      `GRANT ALL ON pointup_chatgpt_transactions, pointup_chatgpt_identities TO PUBLIC`,
      `DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN GRANT ALL ON pointup_chatgpt_transactions, pointup_chatgpt_identities TO anon; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN GRANT ALL ON pointup_chatgpt_transactions, pointup_chatgpt_identities TO authenticated; END IF;
      END $$`,
    ]);
    const beforeTransactions = await sql.unsafe(`SELECT * FROM "${schema}".pointup_chatgpt_transactions`);
    const beforeIdentities = await sql.unsafe(`SELECT * FROM "${schema}".pointup_chatgpt_identities`);
    await apply(schema);
    expect(await sql.unsafe(`SELECT * FROM "${schema}".pointup_chatgpt_transactions`)).toEqual(beforeTransactions);
    expect(await sql.unsafe(`SELECT * FROM "${schema}".pointup_chatgpt_identities`)).toEqual(beforeIdentities);
    await assertProtected(schema);
  });

  it.each([
    ["wrong column type", transactionTable.replace("transaction_data jsonb", "transaction_data text"), identityTable],
    ["nullable expiry", transactionTable.replace("expires_at timestamptz NOT NULL", "expires_at timestamptz"), identityTable],
    ["missing transaction PK", transactionTable.replace("browser_id_hash text PRIMARY KEY", "browser_id_hash text NOT NULL"), identityTable],
    ["missing identity uniqueness", transactionTable, identityTable.replace(", UNIQUE (issuer, client_id, clerk_user_id)", "")],
    ["wrong identity PK", transactionTable, identityTable.replace("PRIMARY KEY (issuer, client_id, subject)", "PRIMARY KEY (subject)")],
    ["missing linked-at default", transactionTable, identityTable.replace(" DEFAULT now()", "")],
    ["unexpected required column", transactionTable.replace("expires_at timestamptz NOT NULL", "expires_at timestamptz NOT NULL, extra text NOT NULL"), identityTable],
  ])("refuses incompatible adoption: %s, without modifying prior data/security", async (_name, transactions, identities) => {
    const schema = await fixture([transactions, identities, `GRANT SELECT ON pointup_chatgpt_transactions TO PUBLIC`]);
    await expect(apply(schema)).rejects.toThrow(/Incompatible SIWC storage/);
    const rows = await sql`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = 'pointup_chatgpt_transactions'`;
    expect(rows[0]?.relrowsecurity).toBe(false);
  });

  it("rolls back a newly created sibling table when adoption validation fails", async () => {
    const schema = await fixture([transactionTable.replace("transaction_data jsonb", "transaction_data text")]);
    await expect(apply(schema)).rejects.toThrow(/Incompatible SIWC storage/);
    expect((await sql`SELECT to_regclass(${schema + '.pointup_chatgpt_identities'}) AS table_name`)[0]?.table_name).toBeNull();
  });
});
