import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import type { MigrationConfig } from "drizzle-orm/migrator";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertMigrationConnectionString, migrateWithLock, MIGRATION_LOCK_KEY } from "../src/infrastructure/db/migrations";

// CI's disposable fixture only. No client or network activity when unset.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ownedSchema = /^pointup_lock_fixture_[a-f0-9]{32}$/;

suite("migration serialization on isolated PostgreSQL schemas", () => {
  let sql: Sql;
  const schemas: string[] = [];
  const directories: string[] = [];

  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Migration integration tests require the dedicated loopback postgres/app fixture.");
    }
    sql = postgres(url!, { max: 2, connect_timeout: 10, onnotice: () => {} });
  });

  afterAll(async () => {
    try {
      if (sql) {
        for (const schema of schemas) {
          if (!ownedSchema.test(schema)) throw new Error("Refusing to remove an unowned migration fixture schema.");
          await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        }
      }
    } finally {
      try { if (sql) await sql.end({ timeout: 5 }); }
      finally {
        for (const directory of directories) await rm(directory, { recursive: true, force: true });
      }
    }
  });

  async function fixture(statement: (schema: string) => string) {
    const schema = `pointup_lock_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    const directory = await mkdtemp(join(tmpdir(), "pointup-lock-fixture-"));
    directories.push(directory);
    await mkdir(join(directory, "meta"));
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({
      version: "7", dialect: "postgresql",
      entries: [{ idx: 0, version: "7", when: 1900000000000, tag: "0000_lock_fixture", breakpoints: true }],
    }));
    const migration = join(directory, "0000_lock_fixture.sql");
    await writeFile(migration, statement(schema));
    const config: MigrationConfig = {
      migrationsFolder: directory,
      migrationsSchema: schema,
      migrationsTable: "fixture_journal",
    };
    return { schema, config, migration };
  }

  const validMigration = (schema: string) =>
    `CREATE TABLE "${schema}"."marker" (id integer PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO "${schema}"."marker" VALUES (1);`;

  it("serializes independent clients before journal reads and applies DDL exactly once", async () => {
    const { schema, config } = await fixture(validMigration);
    const clients = [postgres(url!, { max: 2, onnotice: () => {} }), postgres(url!, { max: 2, onnotice: () => {} })];
    try {
      await Promise.all(clients.map(client => migrateWithLock(drizzle(client), config)));
      expect((await sql.unsafe(`SELECT count(*)::int AS total FROM "${schema}"."fixture_journal"`))[0]?.total).toBe(1);
      expect(await sql.unsafe(`SELECT id FROM "${schema}"."marker"`)).toEqual([{ id: 1 }]);
    } finally {
      await Promise.all(clients.map(client => client.end({ timeout: 5 })));
    }
  }, 30_000);

  it("bounds contention before creating the journal and succeeds after the blocker releases", async () => {
    const { schema, config } = await fixture(validMigration);
    const contender = postgres(url!, { max: 2, onnotice: () => {} });
    const blocker = await sql.reserve();
    try {
      await blocker`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
      await expect(migrateWithLock(drizzle(contender), config, { lockTimeoutMs: 25 })).rejects.toMatchObject({ code: "55P03" });
      expect((await blocker`SELECT to_regnamespace(${schema}) AS fixture`)[0]?.fixture).toBeNull();
      await blocker`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      await migrateWithLock(drizzle(contender), config);
      expect((await blocker`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`)[0]?.acquired).toBe(true);
      await blocker`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      expect((await sql.unsafe(`SELECT count(*)::int AS total FROM "${schema}"."fixture_journal"`))[0]?.total).toBe(1);
    } finally {
      try { await blocker`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`; }
      finally {
        blocker.release();
        await contender.end({ timeout: 5 });
      }
    }
  }, 30_000);

  it("rolls back failed DDL, releases its lock and allows the next valid migration", async () => {
    const { schema, config, migration } = await fixture(name =>
      `CREATE TABLE "${name}"."marker" (id integer PRIMARY KEY);\n--> statement-breakpoint\nSELECT missing_fixture_column FROM "${name}"."marker";`);
    const client = postgres(url!, { max: 2, onnotice: () => {} });
    try {
      await expect(migrateWithLock(drizzle(client), config)).rejects.toThrow();
      expect((await sql`SELECT to_regclass(${schema + ".marker"}) AS marker`)[0]?.marker).toBeNull();
      expect((await sql.unsafe(`SELECT count(*)::int AS total FROM "${schema}"."fixture_journal"`))[0]?.total).toBe(0);
      const probe = await sql.reserve();
      try {
        expect((await probe`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`)[0]?.acquired).toBe(true);
      } finally {
        try { await probe`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`; }
        finally { probe.release(); }
      }
      await writeFile(migration, validMigration(schema));
      await migrateWithLock(drizzle(client), config);
      expect((await sql.unsafe(`SELECT count(*)::int AS total FROM "${schema}"."fixture_journal"`))[0]?.total).toBe(1);
      expect(await sql.unsafe(`SELECT id FROM "${schema}"."marker"`)).toEqual([{ id: 1 }]);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 30_000);
});
