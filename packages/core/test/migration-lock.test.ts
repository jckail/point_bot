import { beforeEach, describe, expect, it, vi } from "vitest";
import postgres, { type Sql, type ReservedSql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertMigrationConnectionString, migrateWithLock, runLockedMigrations } from "../src/infrastructure/db/migrations";

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: vi.fn() }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn() }));

function fixture(failure?: "acquire" | "unlock" | "restore") {
  const calls: string[] = [];
  const release = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn(async (template: TemplateStringsArray) => {
    const text = template.join("?");
    calls.push(text);
    if (failure === "acquire" && text.includes("pg_advisory_lock(")) throw new Error("lock wait exhausted");
    if (failure === "unlock" && text.includes("pg_advisory_unlock(")) throw new Error("connection lost during unlock");
    if (failure === "restore" && text.includes("set_config") && calls.filter(call => call.includes("set_config")).length === 2) throw new Error("timeout restoration failed");
    return text.includes("SHOW") ? [{lock_timeout:"3s"}] : [];
  });
  const lease = Object.assign(query, {release}) as unknown as ReservedSql;
  const client = {options:{max:2},reserve:vi.fn().mockResolvedValue(lease),end} as unknown as Sql;
  const db = {$client:client} as PostgresJsDatabase & {$client:Sql};
  return {db,client,calls,release,end,query};
}

beforeEach(() => {
  vi.mocked(migrate).mockReset();
  vi.mocked(drizzle).mockReset();
  vi.mocked(postgres).mockReset();
});

describe("migration lock failure boundaries", () => {
  it("opens a dedicated TLS-tuned pool and closes it after successful migration", async () => {
    const {db,client,end} = fixture();
    vi.mocked(postgres).mockReturnValue(client);
    vi.mocked(drizzle).mockReturnValue(db);
    vi.mocked(migrate).mockResolvedValueOnce(undefined);
    await runLockedMigrations("postgresql://example.supabase.co/app",{migrationsFolder:"fixture"});
    expect(postgres).toHaveBeenCalledWith("postgresql://example.supabase.co/app",{ssl:"require",max:2});
    expect(migrate).toHaveBeenCalledWith(db,{migrationsFolder:"fixture"});
    expect(end).toHaveBeenCalledWith({timeout:5});
  });

  it("closes the dedicated pool when its migration fails", async () => {
    const {db,client,end} = fixture();
    vi.mocked(postgres).mockReturnValue(client);
    vi.mocked(drizzle).mockReturnValue(db);
    vi.mocked(migrate).mockRejectedValueOnce(new Error("bad migration"));
    await expect(runLockedMigrations("postgresql://localhost/app",{migrationsFolder:"fixture"})).rejects.toThrow("bad migration");
    expect(end).toHaveBeenCalledWith({timeout:5});
  });

  it("rejects a transaction pooler before creating a client", async () => {
    await expect(runLockedMigrations("postgresql://localhost:6543/app",{migrationsFolder:"fixture"})).rejects.toThrow("direct PostgreSQL connection or session pooler");
    expect(postgres).not.toHaveBeenCalled();
    expect(drizzle).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("rejects transaction poolers without disclosing the connection URL", () => {
    for (const address of ["localhost:6432", "host.supabase.com:6543", "localhost:5432?pgbouncer=true", "localhost:5432?pgbouncer=false&pgbouncer=true"]) {
      const [host, query] = address.split("?");
      const connection = `postgresql://private-user:private-password@${host}/private-db${query ? `?${query}` : ""}`;
      expect(() => assertMigrationConnectionString(connection)).toThrow("Locked migrations require a direct PostgreSQL connection or session pooler.");
      try { assertMigrationConnectionString(connection); }
      catch (error) {
        expect(String(error)).not.toContain("private-");
        expect(String(error)).not.toContain(connection);
      }
    }
  });

  it("accepts direct and session-pooled URLs without rejecting explicit SSL settings", () => {
    for (const connection of ["postgresql://localhost/app", "postgres://localhost:5432/app", "postgresql://host.supabase.co:5432/app?sslmode=require", "postgresql://host.pooler.supabase.com:5432/app?pgbouncer=false"]) {
      expect(() => assertMigrationConnectionString(connection)).not.toThrow();
    }
  });

  it("rejects malformed or non-PostgreSQL URLs with a fixed safe error", () => {
    for (const connection of ["private-password", "https://private-user:private-password@localhost/app"]) {
      expect(() => assertMigrationConnectionString(connection)).toThrow("Migrations require a valid PostgreSQL connection URL.");
    }
  });

  it("holds the lock before the migrator reads its journal and restores the session afterward", async () => {
    const {db,calls,release,end} = fixture();
    vi.mocked(migrate).mockImplementationOnce(() => {
      calls.push("migrate");
      return Promise.resolve();
    });
    await migrateWithLock(db,{migrationsFolder:"fixture"});
    expect(calls).toEqual([
      "SHOW lock_timeout",
      "SELECT set_config('lock_timeout', ?, false)",
      "SELECT pg_advisory_lock(?)",
      "migrate",
      "SELECT pg_advisory_unlock(?)",
      "SELECT set_config('lock_timeout', ?, false)",
    ]);
    expect(release).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
  });

  it("closes the dedicated pool when restoring its timeout fails", async () => {
    const {db,end,release} = fixture("restore");
    vi.mocked(migrate).mockResolvedValueOnce(undefined);
    await expect(migrateWithLock(db,{migrationsFolder:"fixture"})).rejects.toThrow("timeout restoration failed");
    expect(end).toHaveBeenCalledWith({timeout:5});
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects invalid timeout bounds before reserving a connection", async () => {
    const {db,client} = fixture();
    for (const lockTimeoutMs of [0, -1, 1.5, 300001, Number.NaN]) {
      await expect(migrateWithLock(db,{migrationsFolder:"fixture"},{lockTimeoutMs})).rejects.toThrow("between 1 and 300000");
    }
    expect(client.reserve).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("does not read or migrate the journal after lock acquisition fails, and releases the lease", async () => {
    const {db,release,query} = fixture("acquire");
    await expect(migrateWithLock(db,{migrationsFolder:"fixture"})).rejects.toThrow("lock wait exhausted");
    expect(migrate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(query.mock.calls.filter(([template]) => template.join("").includes("set_config"))).toHaveLength(2);
  });

  it("releases the session lock when a migration fails without hiding its failure", async () => {
    const {db,calls,release} = fixture();
    vi.mocked(migrate).mockRejectedValueOnce(new Error("bad migration"));
    await expect(migrateWithLock(db,{migrationsFolder:"fixture"})).rejects.toThrow("bad migration");
    expect(calls.some(call => call.includes("pg_advisory_unlock("))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("closes the dedicated client when failed cleanup could retain a session lock", async () => {
    const {db,end,release} = fixture("unlock");
    vi.mocked(migrate).mockResolvedValueOnce(undefined);
    await expect(migrateWithLock(db,{migrationsFolder:"fixture"})).rejects.toThrow("connection lost during unlock");
    expect(end).toHaveBeenCalledWith({timeout:5});
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a single-connection pool before it can deadlock behind its own lease", async () => {
    const {db,client} = fixture();
    client.options.max = 1;
    await expect(migrateWithLock(db,{migrationsFolder:"fixture"})).rejects.toThrow("at least two");
    expect(client.reserve).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });
});
