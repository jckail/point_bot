import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as applicationSchema from "../src/infrastructure/db/schema";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrateWithLock, readMigrationManifest } from "../src/infrastructure/db/migrations";
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: vi.fn() }));
const directories: string[] = [];
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
beforeEach(() => vi.mocked(migrate).mockReset());
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function files() {
  const directory = await mkdtemp(join(tmpdir(), "pointup-attestation-")); directories.push(directory);
  await mkdir(join(directory, "meta"));
  const journal = JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1900000000000, tag: "0000_fixture", breakpoints: true }] });
  const statement = "CREATE TABLE fixture (id integer);\n";
  await writeFile(join(directory, "meta/_journal.json"), journal);
  await writeFile(join(directory, "0000_fixture.sql"), statement);
  const manifest = await readMigrationManifest(directory);
  return { directory, journal, statement, manifest };
}
function database(rows: { hash: string; created_at: string | number }[], hasJournal = true, applicationTables = false, missing?: string) {
  const calls: string[] = [];
  let locked = false;
  const query = vi.fn(async (parts: TemplateStringsArray) => {
    const text = parts.join("?"); calls.push(text);
    if (text.includes("pg_advisory_lock(")) locked = true;
    if (text.includes("pg_advisory_unlock(")) locked = false;
    const tables = Object.values(applicationSchema).flatMap(table => is(table, PgTable) ? [getTableConfig(table)] : []);
    if (text.includes("AS schema_name")) return [{ schema_name: "public" }];
    if (text.includes("pg_attribute")) return tables.flatMap(table => table.columns.map(column => ({ table_name: table.name, column_name: column.name, type_name: missing === "card_type" && column.name === "card_product_id" ? "text" : column.getSQLType() === "varchar(64)" ? "character varying(64)" : column.getSQLType(), not_null: missing === "card_nullability" && column.name === "card_product_id" ? true : column.notNull, row_security: missing !== "rls" || table.name !== "award_watch" })))
      .filter(row => missing !== "table" || row.table_name !== "award_watch").filter(row => missing !== "column" || row.table_name !== "loyalty_account" || row.column_name !== "notes");
    if (text.includes("pg_constraint")) return [
      ...tables.flatMap(table => table.checks.map(check => ({ table_name: table.name, name: check.name, type: "c", validated: !(missing === "card_check" && check.name === "loyalty_account_card_product_check") }))),
      { table_name: "agent_observation", name: "agent_observation_owned_account_fk", type: "f" },
      { table_name: "trip_goal_account", name: "trip_goal_account_owned_goal_fk", type: "f" },
      { table_name: "trip_goal_account", name: "trip_goal_account_owned_account_fk", type: "f" },
    ].filter(row => missing !== "check" || row.name !== "balance_snapshot_points_check").filter(row => missing !== "fk" || row.name !== "agent_observation_owned_account_fk");
    if (text.includes("pg_trigger")) return missing === "trigger" ? [] : [{ table_name: "trip_goal_account", name: "trip_goal_account_derive_owner" }];
    return text.includes("SHOW") ? [{ lock_timeout: "0" }] : text.includes("to_regclass") ? [{ journal: hasJournal ? "drizzle.__drizzle_migrations" : null }] : text.includes("pg_catalog.pg_class") ? [{ present: applicationTables }] : [];
  });
  const unsafe = vi.fn(async () => { expect(locked).toBe(true); calls.push("journal"); return rows; });
  const release = vi.fn();
  const lease = Object.assign(query, { unsafe, release });
  const client = { options: { max: 2 }, reserve: vi.fn(async () => lease), end: vi.fn() } as unknown as Sql;
  return { db: { $client: client } as PostgresJsDatabase & { $client: Sql }, calls, unsafe, release, markJournalCreated: () => { hasJournal = true; }, isLocked: () => locked };
}
describe("managed migration manifest and journal attestation", () => {
  it("hashes actual journal and SQL bytes using deterministic version-one framing", async () => {
    const f = await files();
    const expected = hash(JSON.stringify({ version: 1, files: [{ path: "meta/_journal.json", sha256: hash(f.journal) }, { path: "0000_fixture.sql", sha256: hash(f.statement) }] }));
    expect(f.manifest.manifestSha256).toBe(expected);
    await writeFile(join(f.directory, "0000_fixture.sql"), f.statement + "-- changed\n");
    expect((await readMigrationManifest(f.directory)).manifestSha256).not.toBe(expected);
    await writeFile(join(f.directory, "0000_fixture.sql"), f.statement);
    await writeFile(join(f.directory, "meta/_journal.json"), f.journal + "\n");
    expect((await readMigrationManifest(f.directory)).manifestSha256).not.toBe(expected);
  });
  it("verifies every journal hash/timestamp under the lock and emits only safe attestation fields", async () => {
    const f = await files(); const d = database([{ hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }]);
    vi.mocked(migrate).mockImplementationOnce(async () => { expect(d.isLocked()).toBe(true); d.calls.push("migrate"); });
    const onAttested = vi.fn(async () => { expect(d.isLocked()).toBe(true); d.calls.push("attested"); });
    const attestation = await migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256, onAttested });
    expect(attestation).toEqual({ component: "pointup_migrations", event: "journal_verified", manifestSha256: f.manifest.manifestSha256, migrationCount: 1 });
    expect(d.calls.indexOf("journal")).toBeLessThan(d.calls.indexOf("migrate"));
    expect(d.calls.indexOf("migrate")).toBeLessThan(d.calls.lastIndexOf("journal"));
    expect(d.calls.indexOf("attested")).toBeLessThan(d.calls.findIndex(call => call.includes("pg_advisory_unlock")));
    expect(d.release).toHaveBeenCalledOnce();
  });
  it("rejects a mismatched baked candidate before running migrations", async () => {
    const f = await files(); const d = database([]);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: "0".repeat(64) })).rejects.toThrow("Baked migration manifest does not match");
    expect(migrate).not.toHaveBeenCalled(); expect(d.release).toHaveBeenCalledOnce();
  });
  it.each(["missing", "hash", "timestamp"])("refuses %s database journal entries", async kind => {
    const f = await files(); const d = database(kind === "missing" ? [] : [{ hash: kind === "hash" ? "0".repeat(64) : f.manifest.entries[0]!.hash, created_at: kind === "timestamp" ? "1900000000001" : "1900000000000" }]);
    const onAttested = vi.fn();
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256, onAttested })).rejects.toThrow("Managed migration journal does not match");
    expect(onAttested).not.toHaveBeenCalled(); expect(d.isLocked()).toBe(false);
    if (kind !== "missing") expect(migrate).not.toHaveBeenCalled();
  });
  it("refuses extra journal entries and does not certify an ahead-of-candidate database", async () => {
    const f = await files(); const entry = { hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }; const d = database([entry, entry]);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256 })).rejects.toThrow("journal does not match");
  });
  it("blocks a dirty prefix before any pending SQL can execute", async () => {
    const f = await files();
    const journal = JSON.parse(f.journal) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
    journal.entries.push({ idx: 1, version: "7", when: 1900000000001, tag: "0001_pending", breakpoints: true });
    await writeFile(join(f.directory, "meta/_journal.json"), JSON.stringify(journal));
    await writeFile(join(f.directory, "0001_pending.sql"), "CREATE TABLE must_not_execute (id integer);\n");
    const manifest = await readMigrationManifest(f.directory);
    const d = database([{ hash: "0".repeat(64), created_at: "1900000000000" }]);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: manifest.manifestSha256 })).rejects.toThrow("journal does not match");
    expect(migrate).not.toHaveBeenCalled();
  });
  it("allows a missing journal only as an empty prefix and verifies its creation afterward", async () => {
    const f = await files(); const d = database([], false);
    vi.mocked(migrate).mockImplementationOnce(async () => { d.markJournalCreated(); d.unsafe.mockResolvedValueOnce([{ hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }]); });
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256 })).resolves.toMatchObject({ migrationCount: 1 });
    expect(d.unsafe).toHaveBeenCalledOnce();
  });
  it.each([false, true])("blocks preexisting application tables with absent/empty journal (exists=%s)", async journalExists => {
    const f = await files(); const d = database([], journalExists, true);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256 })).rejects.toThrow("journal is missing or empty for existing PointUp");
    expect(migrate).not.toHaveBeenCalled(); expect(d.isLocked()).toBe(false);
  });
  it("preserves ordinary local/adoption behavior without candidate mode", async () => {
    const f = await files(); const d = database([], false, true);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory })).resolves.toBeUndefined();
    expect(migrate).toHaveBeenCalledOnce();
    expect(d.calls.some(call => call.includes("pg_catalog.pg_class"))).toBe(false);
  });
  it("rejects a failed journal read without exposing driver detail", async () => {
    const f = await files(); const d = database([]);
    d.unsafe.mockRejectedValueOnce(new Error("private SQL and server credentials"));
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256 })).rejects.toThrow("Managed migration journal verification failed.");
    expect(migrate).not.toHaveBeenCalled();
  });
  it("detects baked files changing during migration", async () => {
    const f = await files(); const d = database([{ hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }]);
    vi.mocked(migrate).mockImplementationOnce(async () => { await writeFile(join(f.directory, "0000_fixture.sql"), f.statement + "-- altered\n"); });
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256 })).rejects.toThrow("changed during migration");
  });
  it("marks schema verified only after the bounded physical contract succeeds", async () => {
    const f = await files(); const d = database([{ hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }]);
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256, verifyApplicationSchema: true })).resolves.toMatchObject({ schemaVerified: true });
    expect(d.calls.findIndex(call => call.includes("pg_attribute"))).toBeGreaterThan(d.calls.lastIndexOf("journal"));
  });
  it.each(["table", "column", "check", "fk", "trigger", "rls", "card_type", "card_nullability", "card_check"])("refuses physical %s drift despite an intact journal", async missing => {
    const f = await files(); const d = database([{ hash: f.manifest.entries[0]!.hash, created_at: "1900000000000" }], true, false, missing);
    const onAttested = vi.fn();
    await expect(migrateWithLock(d.db, { migrationsFolder: f.directory }, { expectedManifestSha256: f.manifest.manifestSha256, verifyApplicationSchema: true, onAttested })).rejects.toThrow("Managed physical schema does not satisfy");
    expect(onAttested).not.toHaveBeenCalled(); expect(d.isLocked()).toBe(false);
  });
  it("rejects malformed manifests without exposing filesystem paths", async () => {
    const f = await files(); await writeFile(join(f.directory, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1, tag: "../private", breakpoints: true }] }));
    await expect(readMigrationManifest(f.directory)).rejects.toThrow("Managed migration manifest is missing or invalid.");
    try { await readMigrationManifest(f.directory); } catch (error) { expect(String(error)).not.toContain(f.directory); }
  });
  it("rejects malformed expected digests before acquiring a session", async () => {
    const d = database([]);
    await expect(migrateWithLock(d.db, { migrationsFolder: "unused" }, { expectedManifestSha256: "private-value" })).rejects.toThrow("lowercase SHA-256");
    expect(d.db.$client.reserve).not.toHaveBeenCalled();
  });
});
