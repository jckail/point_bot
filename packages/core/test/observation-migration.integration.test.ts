import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import type { Database } from "../src/infrastructure/db/client";
import { DrizzleRetentionStore } from "../src/infrastructure/retention/drizzle-retention-repository";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const owned = /^pointup_observation_fixture_[a-f0-9]{32}$/;
const created = "2026-10-02T00:00:00Z";
suite("observation provenance migration on isolated PostgreSQL schemas", () => {
  let sql: Sql;
  let migration: string;
  const schemas: string[] = [];
  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Observation migration tests require dedicated loopback postgres/app.");
    }
    migration = await readFile(new URL("../drizzle/0019_observation_provenance_replay.sql", import.meta.url), "utf8");
    sql = postgres(url!, { max: 2, connect_timeout: 10, onnotice: () => {} });
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      for (const schema of schemas) {
        if (!owned.test(schema)) throw new Error("Refusing to remove an unowned observation fixture schema.");
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally { await sql.end({ timeout: 5 }); }
  });
  async function scoped<T>(schema: string, fn: (tx: TransactionSql) => Promise<T>) {
    return sql.begin(async tx => { await tx.unsafe(`SET LOCAL search_path TO "${schema}"`); return fn(tx); });
  }
  async function fixture(legacy = false) {
    const schema = `pointup_observation_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await scoped(schema, async tx => {
      // Minimal pre-0019 shapes retain the original account-erasure cascade.
      await tx.unsafe(`CREATE TABLE loyalty_account (id varchar(255) PRIMARY KEY, user_id varchar(255) NOT NULL, provider_id varchar(64) NOT NULL, deleted_at timestamptz)`);
      await tx.unsafe(`CREATE TABLE agent_observation (
        id varchar(255) PRIMARY KEY, user_id varchar(255) NOT NULL, account_id varchar(255) NOT NULL REFERENCES loyalty_account(id) ON DELETE CASCADE,
        provider_id varchar(64) NOT NULL, skill_id varchar(96) NOT NULL, agent varchar(64) NOT NULL, source_host varchar(255) NOT NULL,
        points bigint NOT NULL, previous_points bigint, outcome varchar(16) NOT NULL, observed_at timestamptz NOT NULL, created_at timestamptz NOT NULL)`);
      await tx.unsafe(`CREATE TABLE access_token (id varchar(255) PRIMARY KEY, expires_at timestamptz, revoked_at timestamptz)`);
      await tx.unsafe(`CREATE TABLE consent_grant (id varchar(255) PRIMARY KEY, expires_at timestamptz NOT NULL, revoked_at timestamptz)`);
      await tx.unsafe(`INSERT INTO loyalty_account (id,user_id,provider_id) VALUES ('account','owner','hyatt'), ('other-account','other-owner','hyatt')`);
      if (legacy) {
        for (const [id, owner, outcome] of [["legacy-held", "owner", "needs_review"], ["legacy-recorded", "owner", "recorded"], ["legacy-owner-mismatch", "foreign-owner", "needs_review"]]) {
          await tx`INSERT INTO agent_observation (id,user_id,account_id,provider_id,skill_id,agent,source_host,points,previous_points,outcome,observed_at,created_at)
            VALUES (${id!},${owner!},'account','hyatt','skill','legacy-agent','provider.test',100,50,${outcome!},${created}::timestamptz,${created}::timestamptz)`;
        }
      }
    });
    return schema;
  }
  async function apply(schema: string) {
    await scoped(schema, async tx => { for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await tx.unsafe(statement); });
  }
  function reading(overrides: Record<string, unknown> = {}) {
    return { id: randomUUID(), user_id: "owner", account_id: "account", provider_id: "hyatt", skill_id: "skill", agent: "synthetic-agent", source_host: "provider.test",
      points: 100, previous_points: 50, outcome: "unchanged", observed_at: created, created_at: created,
      provenance_version: 1, credential_kind: "personal_access_token", access_token_id: "retained-token", consent_id: "retained-consent",
      consent_granted_at: "2026-10-01T00:00:00Z", consent_expires_at: "2026-10-03T00:00:00Z", skill_version: 1, source_method: "unknown",
      capture_id: randomUUID(), payload_hash: "a".repeat(64), baseline_snapshot_id: "baseline-witness", recorded_snapshot_id: null,
      review_expires_at: null, reviewed_at: null, review_decision: null, ...overrides };
  }
  async function insert(schema: string, row = reading()) {
    await scoped(schema, async tx => { await tx`INSERT INTO agent_observation ${tx(row)}`; });
  }

  it("preserves legacy rows, marks unknown provenance, backfills only pending review deadlines", async () => {
    const schema = await fixture(true);
    const before = await scoped(schema, async tx => tx`SELECT id,user_id,outcome,points,previous_points FROM agent_observation ORDER BY id`);
    await apply(schema);
    const after = await scoped(schema, async tx => tx`SELECT * FROM agent_observation ORDER BY id`);
    expect(after.map(({ id, user_id, outcome, points, previous_points }) => ({ id, user_id, outcome, points, previous_points }))).toEqual([...before]);
    for (const row of after) {
      expect(row.provenance_version).toBe(0);
      for (const field of ["credential_kind", "access_token_id", "consent_id", "skill_version", "source_method", "capture_id", "payload_hash", "baseline_snapshot_id", "recorded_snapshot_id", "reviewed_at", "review_decision"]) expect(row[field]).toBeNull();
      expect(row.review_expires_at).toEqual(row.outcome === "needs_review" ? new Date("2026-10-03T00:00:00Z") : null);
    }
    const constraint = await sql`SELECT convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${schema} AND c.conname='agent_observation_owned_account_fk'`;
    expect(constraint[0]?.convalidated).toBe(false);
    await expect(insert(schema, reading({ user_id: "foreign-owner" }))).rejects.toMatchObject({ code: "23503" });
    await expect(insert(schema, reading({ provider_id: "united" }))).rejects.toMatchObject({ code: "23503" });
  });
  it("enforces owner-scoped capture uniqueness while allowing independent owners and omitted keys", async () => {
    const schema = await fixture(); await apply(schema);
    const capture = randomUUID();
    await insert(schema, reading({ capture_id: capture }));
    await expect(insert(schema, reading({ capture_id: capture }))).rejects.toMatchObject({ code: "23505" });
    await insert(schema, reading({ capture_id: capture, user_id: "other-owner", account_id: "other-account" }));
    await insert(schema, reading({ capture_id: null })); await insert(schema, reading({ capture_id: null }));
  });
  it.each([
    ["missing trusted credential", { credential_kind: null }], ["PAT without token witness", { access_token_id: null }],
    ["session with PAT witness", { credential_kind: "session" }], ["missing selected grant", { consent_id: null }],
    ["expired consent witness", { consent_expires_at: created }], ["negative skill version", { skill_version: -1 }],
    ["unknown capture method", { source_method: "browser-password" }], ["missing digest", { payload_hash: null }],
    ["invalid replay ID", { capture_id: "not-a-uuid" }], ["unsafe points", { points: "9007199254740992" }],
    ["future capture", { observed_at: "2026-10-03T00:00:00Z" }], ["held without deadline", { outcome: "needs_review" }],
    ["recorded without snapshot", { outcome: "recorded" }], ["rejection without decision", { outcome: "rejected", review_expires_at: "2026-10-03T00:00:00Z", reviewed_at: created }],
  ])("rejects invalid new-row provenance: %s", async (_name, overrides) => {
    const schema = await fixture(); await apply(schema);
    await expect(insert(schema, reading(overrides))).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps rejection cleanup after expiry, but rejects confirmation at expiry", async () => {
    const schema = await fixture(); await apply(schema);
    await insert(schema, reading({ outcome: "rejected", review_expires_at: "2026-10-03T00:00:00Z", reviewed_at: "2026-10-04T00:00:00Z", review_decision: "reject" }));
    await expect(insert(schema, reading({ outcome: "recorded", recorded_snapshot_id: "recorded-witness", review_expires_at: "2026-10-03T00:00:00Z", reviewed_at: "2026-10-03T00:00:00Z", review_decision: "confirm" }))).rejects.toMatchObject({ code: "23514" });
  });
  it("purges stale credential/grant rows without erasing scalar witnesses or audit, preserving account erasure semantics", async () => {
    const schema = await fixture(); await apply(schema);
    const row = reading({ outcome: "recorded", recorded_snapshot_id: "recorded-witness" });
    await insert(schema, row);
    await scoped(schema, async tx => {
      await tx`INSERT INTO access_token (id,expires_at) VALUES ('retained-token','2026-10-03')`;
      await tx`INSERT INTO consent_grant (id,expires_at) VALUES ('retained-consent','2026-10-03')`;
      // Execute the real retention adapter's SQL on this schema-scoped session.
      const dialect = new PgDialect();
      const retention = new DrizzleRetentionStore({ execute: (statement: SQL) => {
        const query = dialect.sqlToQuery(statement);
        return tx.unsafe(query.sql, query.params as Parameters<typeof tx.unsafe>[1]);
      } } as unknown as Database);
      expect(await retention.purgeBatch("access_tokens", new Date("2027-01-01"), 10)).toBe(1);
      expect(await retention.purgeBatch("consents", new Date("2027-01-01"), 10)).toBe(1);
      const retained = await tx`SELECT access_token_id,consent_id,baseline_snapshot_id,recorded_snapshot_id FROM agent_observation WHERE id=${row.id}`;
      expect(retained[0]).toEqual({ access_token_id: "retained-token", consent_id: "retained-consent", baseline_snapshot_id: "baseline-witness", recorded_snapshot_id: "recorded-witness" });
      await tx`UPDATE loyalty_account SET deleted_at=now() WHERE id='account'`;
      expect(await tx`SELECT id FROM agent_observation WHERE id=${row.id}`).toHaveLength(1);
      await tx`DELETE FROM loyalty_account WHERE id='account'`;
      expect(await tx`SELECT id FROM agent_observation WHERE id=${row.id}`).toHaveLength(0);
    });
  });
});
