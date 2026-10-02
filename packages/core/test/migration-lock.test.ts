import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql, ReservedSql } from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrateWithLock } from "../src/infrastructure/db/migrations";

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: vi.fn() }));

function fixture(failure?: "acquire" | "unlock") {
  const calls: string[] = [];
  const release = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn(async (template: TemplateStringsArray) => {
    const text = template.join("?");
    calls.push(text);
    if (failure === "acquire" && text.includes("pg_advisory_lock(")) throw new Error("lock wait exhausted");
    if (failure === "unlock" && text.includes("pg_advisory_unlock(")) throw new Error("connection lost during unlock");
    return text.includes("SHOW") ? [{lock_timeout:"3s"}] : [];
  });
  const lease = Object.assign(query, {release}) as unknown as ReservedSql;
  const client = {options:{max:2},reserve:vi.fn().mockResolvedValue(lease),end} as unknown as Sql;
  const db = {$client:client} as PostgresJsDatabase & {$client:Sql};
  return {db,client,calls,release,end,query};
}

beforeEach(() => vi.mocked(migrate).mockReset());

describe("migration lock failure boundaries", () => {
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
