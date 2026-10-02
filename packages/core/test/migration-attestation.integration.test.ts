import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertMigrationConnectionString,
  MIGRATION_LOCK_KEY,
  migrateWithLock,
  readMigrationManifest,
  type MigrationAttestation,
} from "../src/infrastructure/db/migrations";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ownedSchema = /^pointup_attest_fixture_[a-f0-9]{32}$/;
const ownedFolder = /^pointup-attest-pg-[a-zA-Z0-9]+$/;

suite("candidate migration attestation on isolated PostgreSQL", () => {
  let admin: Sql;
  const clients: Sql[] = [];
  const schemas: string[] = [];
  const folders: string[] = [];
  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Migration attestation tests require dedicated loopback postgres/app.");
    }
    admin = postgres(url!, { max: 2, onnotice: () => {} });
  });
  afterAll(async () => {
    try {
      for (const client of clients) await client.end({ timeout: 5 });
      if (admin) for (const name of schemas) {
        if (!ownedSchema.test(name)) throw new Error("Refusing to remove an unowned attestation schema.");
        await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      }
      for (const directory of folders) {
        if (join(tmpdir(), directory.split("/").at(-1)!) !== directory || !ownedFolder.test(directory.split("/").at(-1)!)) {
          throw new Error("Refusing to remove an unowned attestation folder.");
        }
        await rm(directory, { recursive: true, force: true });
      }
    } finally { if (admin) await admin.end({ timeout: 5 }); }
  });

  async function fixture(prefix: boolean) {
    const name = `pointup_attest_fixture_${randomUUID().replaceAll("-", "")}`;
    schemas.push(name);
    await admin.unsafe(`CREATE SCHEMA "${name}"`);
    const folder = await mkdtemp(join(tmpdir(), "pointup-attest-pg-"));
    folders.push(folder);
    await mkdir(join(folder, "meta"));
    const entries = [
      { idx: 0, version: "7", when: 1900000000000, tag: "0000_baseline", breakpoints: true },
      { idx: 1, version: "7", when: 1900000001000, tag: "0001_pending", breakpoints: true },
    ];
    await writeFile(join(folder, "0000_baseline.sql"), `CREATE TABLE "${name}".baseline (id integer PRIMARY KEY);\n`);
    await writeFile(join(folder, "0001_pending.sql"), `CREATE TABLE "${name}".pending (id integer PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO "${name}".pending VALUES (7);\n`);
    const writeJournal = (count: number) => writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.slice(0, count) }));
    const client = postgres(url!, { max: 2, onnotice: () => {} });
    clients.push(client);
    const db = drizzle(client);
    const config = { migrationsFolder: folder, migrationsSchema: name, migrationsTable: "candidate_journal" };
    if (prefix) {
      await writeJournal(1);
      await migrateWithLock(db, config);
    }
    await writeJournal(2);
    const manifest = await readMigrationManifest(folder);
    const journal = () => client.unsafe<{ id: number; hash: string; created_at: string }[]>(`SELECT id, hash, created_at::text FROM "${name}".candidate_journal ORDER BY id`);
    const relationExists = async (table: string) => {
      const [row] = await client<{ present: boolean }[]>`SELECT to_regclass(${name + "." + table}) IS NOT NULL AS present`;
      return row?.present;
    };
    return { name, client, db, config, manifest, journal, relationExists };
  }

  async function managedFixture() {
    const f = await fixture(false);
    const rawJournal = await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url));
    const journal = JSON.parse(rawJournal.toString("utf8")) as { entries: { tag: string }[] };
    // Managed SQL contains public-qualified FKs. Remap only that qualification
    // in the scratch copies so no fixture can reference shared/public data.
    // The manifest hashes these actual scratch bytes, not the repository bytes.
    for (const entry of journal.entries) {
      const statement = await readFile(new URL("../drizzle/" + entry.tag + ".sql", import.meta.url), "utf8");
      await writeFile(join(f.config.migrationsFolder, entry.tag + ".sql"), statement.replaceAll('"public".', '"' + f.name + '".'));
    }
    await writeFile(join(f.config.migrationsFolder, "meta/_journal.json"), rawJournal);
    const client = postgres(url!, { max: 2, connection: { search_path: f.name }, onnotice: () => {} });
    clients.push(client);
    const db = drizzle(client);
    const manifest = await readMigrationManifest(f.config.migrationsFolder);
    const options = { applicationSchema: f.name, expectedManifestSha256: manifest.manifestSha256, verifyApplicationSchema: true };
    const attestation = await migrateWithLock(db, f.config, options);
    return { ...f, client, db, manifest, options, attestation };
  }

  it.each(["hash", "timestamp"])("rejects a dirty %s prefix before pending DDL and preserves the journal", async field => {
    const f = await fixture(true);
    // Keep the dirty timestamp below the pending timestamp: an unchecked Drizzle
    // migrator would apply pending SQL, rather than merely consider it up-to-date.
    await f.client.unsafe(field === "hash"
      ? `UPDATE "${f.name}".candidate_journal SET hash='${"0".repeat(64)}'`
      : `UPDATE "${f.name}".candidate_journal SET created_at=1900000000005`);
    const before = await f.journal();
    let attested = false;
    await expect(migrateWithLock(f.db, f.config, {
      applicationSchema: f.name, expectedManifestSha256: f.manifest.manifestSha256,
      onAttested: () => { attested = true; },
    })).rejects.toThrow("Managed migration journal does not match the approved manifest.");
    expect(await f.relationExists("baseline")).toBe(true);
    expect(await f.relationExists("pending")).toBe(false);
    expect(await f.journal()).toEqual(before);
    expect(attested).toBe(false);
  });

  it("applies a valid prefix remainder and attests while the actual session lock is held", async () => {
    const f = await fixture(true);
    const prefix = await f.journal();
    expect(prefix.map(row => ({ hash: row.hash, when: row.created_at }))).toEqual([
      { hash: f.manifest.entries[0]!.hash, when: String(f.manifest.entries[0]!.when) },
    ]);
    const probe = await admin.reserve();
    const attestations: MigrationAttestation[] = [];
    try {
      const result = await migrateWithLock(f.db, f.config, {
        applicationSchema: f.name, expectedManifestSha256: f.manifest.manifestSha256,
        onAttested: async value => {
          const [row] = await probe<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`;
          // If this assertion fails, release the probe's unexpected lock before
          // throwing so the test itself cannot leave a session lock behind.
          if (row?.acquired) await probe`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
          expect(row?.acquired).toBe(false);
          expect((await f.journal()).map(entry => ({ hash: entry.hash, when: entry.created_at }))).toEqual(
            f.manifest.entries.map(entry => ({ hash: entry.hash, when: String(entry.when) })),
          );
          attestations.push(value);
        },
      });
      expect(result).toEqual({ component: "pointup_migrations", event: "journal_verified", manifestSha256: f.manifest.manifestSha256, migrationCount: 2 });
      expect(attestations).toEqual([result]);
      expect(await f.client.unsafe(`SELECT id FROM "${f.name}".pending`)).toEqual([{ id: 7 }]);
      expect((await f.journal())[0]).toEqual(prefix[0]);
      const [released] = await probe<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired`;
      if (released?.acquired) await probe`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      expect(released?.acquired).toBe(true);
    } finally { probe.release(); }
  });

  it("rejects a fresh baked manifest mismatch before creating any DDL or journal", async () => {
    const f = await fixture(false);
    await expect(migrateWithLock(f.db, f.config, { applicationSchema: f.name, expectedManifestSha256: "0".repeat(64) })).rejects.toThrow("Baked migration manifest does not match the approved candidate.");
    for (const table of ["baseline", "pending", "candidate_journal"]) expect(await f.relationExists(table)).toBe(false);
  });

  it.each(["loyalty_account", "pointup_legacy_receipt"])("rejects an empty legacy %s table without a journal before pending DDL", async table => {
    const f = await fixture(false);
    await f.client.unsafe(`CREATE TABLE "${f.name}"."${table}" (id integer PRIMARY KEY)`);
    const before = await f.client.unsafe(`SELECT * FROM "${f.name}"."${table}"`);
    await expect(migrateWithLock(f.db, f.config, { applicationSchema: f.name, expectedManifestSha256: f.manifest.manifestSha256 })).rejects.toThrow("journal is missing or empty for existing PointUp application tables.");
    for (const relation of ["baseline", "pending", "candidate_journal"]) expect(await f.relationExists(relation)).toBe(false);
    expect(await f.client.unsafe(`SELECT * FROM "${f.name}"."${table}"`)).toEqual(before);
  });

  it("allows unrelated application tables in a fresh PointUp schema", async () => {
    const f = await fixture(false);
    await f.client.unsafe(`CREATE TABLE "${f.name}".unrelated_supabase_table (id integer PRIMARY KEY)`);
    await expect(migrateWithLock(f.db, f.config, { applicationSchema: f.name, expectedManifestSha256: f.manifest.manifestSha256 })).resolves.toMatchObject({ migrationCount: 2 });
    expect(await f.relationExists("unrelated_supabase_table")).toBe(true);
  });

  it("creates a fresh managed journal and attests actual Drizzle hashes and timestamps", async () => {
    const f = await fixture(false);
    await expect(migrateWithLock(f.db, f.config, { applicationSchema: f.name, expectedManifestSha256: f.manifest.manifestSha256 })).resolves.toMatchObject({ migrationCount: 2 });
    expect((await f.journal()).map(row => ({ hash: row.hash, when: row.created_at }))).toEqual(
      f.manifest.entries.map(entry => ({ hash: entry.hash, when: String(entry.when) })),
    );
  });
  it("marks full managed schema readiness while accepting NOT VALID numeric constraints", async () => {
    const f = await managedFixture();
    expect(f.attestation).toMatchObject({ schemaVerified: true, migrationCount: f.manifest.entries.length });
    const rows = await f.client<{ convalidated: boolean }[]>`
      SELECT co.convalidated FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
      WHERE n.nspname=${f.name} AND co.conname='balance_snapshot_points_check'`;
    expect(rows).toEqual([{ convalidated: false }]);
  });

  it.each(["table", "column", "check", "fk", "trigger", "rls"])("refuses managed physical %s drift despite an unchanged full journal", async drift => {
    const f = await managedFixture();
    const journalBefore = await f.journal();
    const mutations: Record<string, string> = {
      rls: `ALTER TABLE "${f.name}".award_watch DISABLE ROW LEVEL SECURITY`,
      table: `DROP TABLE "${f.name}".award_watch`,
      column: `ALTER TABLE "${f.name}".loyalty_account DROP COLUMN notes`,
      check: `ALTER TABLE "${f.name}".balance_snapshot DROP CONSTRAINT balance_snapshot_points_check`,
      fk: `ALTER TABLE "${f.name}".agent_observation DROP CONSTRAINT agent_observation_owned_account_fk`,
      trigger: `DROP TRIGGER trip_goal_account_derive_owner ON "${f.name}".trip_goal_account`,
    };
    await f.client.unsafe(mutations[drift]!);
    let attested = false;
    await expect(migrateWithLock(f.db, f.config, { ...f.options, onAttested: () => { attested = true; } })).rejects.toThrow("Managed physical schema does not satisfy the candidate readiness contract.");
    expect(await f.journal()).toEqual(journalBefore);
    expect(attested).toBe(false);
  });

});
