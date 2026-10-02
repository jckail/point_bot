import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../src/infrastructure/db/schema";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { DrizzleBalanceSnapshotRepository, DrizzleLoyaltyAccountRepository } from "../src/infrastructure/repositories/drizzle-loyalty-account-repository";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";

// Deliberately separate from DATABASE_URL; never reads the application's env.
const integrationUrl = process.env.DATABASE_INTEGRATION_URL;
const suite = integrationUrl ? describe : describe.skip;

suite("dedicated PostgreSQL integration fixture", () => {
  const owner = `fixture-${randomUUID()}`;
  const browserRole = `pointup_browser_${randomUUID().replaceAll("-", "")}`;
  let sql: ReturnType<typeof postgres>;
  let accounts: DrizzleLoyaltyAccountRepository;
  let balances: DrizzleBalanceSnapshotRepository;
  let roleCreated = false;

  beforeAll(async () => {
    const url = new URL(integrationUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/pointup_integration" || url.username !== "pointup_fixture") {
      throw new Error("Integration URL must target the dedicated loopback pointup_fixture/pointup_integration database.");
    }
    sql = postgres(integrationUrl!, { max: 4, connect_timeout: 10, onnotice: () => {} });
    const db = drizzle(sql, { schema });
    const lease = await sql.reserve();
    await lease`SELECT pg_advisory_lock(846795951)`;
    try { await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) }); }
    finally { await lease`SELECT pg_advisory_unlock(846795951)`; lease.release(); }
    const managed = await sql`SELECT to_regclass('public.pointup_chatgpt_transactions') AS transactions, to_regclass('public.pointup_chatgpt_identities') AS identities`;
    expect(managed[0]?.transactions).not.toBeNull();
    expect(managed[0]?.identities).not.toBeNull();
    await sql.unsafe(await readFile(new URL("../../../apps/web/src/server/chatgpt/storage.sql", import.meta.url), "utf8"));
    await sql.unsafe(`CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    roleCreated = true;
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${browserRole}`);
    accounts = new DrizzleLoyaltyAccountRepository(db);
    balances = new DrizzleBalanceSnapshotRepository(db);
  }, 30_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      if (!roleCreated) return;
      await sql`DELETE FROM loyalty_account WHERE user_id = ${owner}`;
      await sql`DELETE FROM pointup_chatgpt_transactions WHERE browser_id_hash LIKE ${owner + "%"}`;
      await sql`DELETE FROM pointup_chatgpt_identities WHERE issuer = ${owner}`;
      await sql.unsafe(`DROP OWNED BY ${browserRole}`);
      await sql.unsafe(`DROP ROLE ${browserRole}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("applies all existing Drizzle migrations and server-only storage SQL", async () => {
    const rows = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] };
    expect(rows[0]?.count).toBe(journal.entries.length);
    const security = await sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pointup_chatgpt_transactions', 'pointup_chatgpt_identities')`;
    expect(security).toHaveLength(2);
    expect(security.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("arbitrates concurrent provider links with the real unique index", async () => {
    const results = await Promise.allSettled(["first", "second"].map((membershipNumber) => accounts.insert(createLoyaltyAccount({ userId: owner, providerId: "hyatt", membershipNumber }))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("DUPLICATE_LOYALTY_ACCOUNT");
    expect(await accounts.findByUserId(owner)).toHaveLength(1);
  });

  it("preserves latest/history chronology when backfilled observations arrive later", async () => {
    const account = createLoyaltyAccount({ userId: owner, providerId: "united", membershipNumber: "fixture-chronology" });
    await accounts.insert(account);
    const record = new RecordManualBalance(accounts, balances, undefined, { now: () => new Date("2026-10-01") });
    await record.execute({ userId: owner, accountId: account.id, points: 700, capturedAt: new Date("2026-09-15") });
    await record.execute({ userId: owner, accountId: account.id, points: 300, capturedAt: new Date("2026-08-15") });
    expect((await balances.findLatestByAccountIds([account.id])).get(account.id)?.points).toBe(700);
    expect((await balances.findByAccountId(account.id, 10)).map((row) => row.points)).toEqual([700, 300]);
    expect((await accounts.findById(account.id))?.expiresAt).toBeNull();
  });

  it("enforces snapshot references and cascades only hard-deleted account history", async () => {
    await expect(balances.insert(createBalanceSnapshot({ loyaltyAccountId: randomUUID(), points: 5, source: "manual" }))).rejects.toThrow();
    const account = createLoyaltyAccount({ userId: owner, providerId: "delta", membershipNumber: "fixture-cascade" });
    await accounts.insert(account);
    await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 500, source: "manual" }));
    await accounts.update({ ...account, deletedAt: new Date() });
    expect((await accounts.findByUserId(owner)).some((row) => row.id === account.id)).toBe(false);
    expect(await balances.findByAccountId(account.id, 10)).toHaveLength(1);
    await accounts.delete(account.id);
    expect(await balances.findByAccountId(account.id, 10)).toHaveLength(0);
  });

  it("consumes a SIWC transaction exactly once across concurrent SQL callbacks", async () => {
    const key = `${owner}-consume`;
    await sql`INSERT INTO pointup_chatgpt_transactions VALUES (${key}, ${JSON.stringify({ state: "fixture-state" })}::jsonb, now() + interval '10 minutes')`;
    const consume = () => sql`DELETE FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${key} RETURNING transaction_data`;
    const results = await Promise.all([consume(), consume(), consume(), consume()]);
    expect(results.map((rows) => rows.length).sort()).toEqual([0, 0, 0, 1]);
    expect(await consume()).toHaveLength(0);
  });

  it("preserves one-time transaction data when the consume transaction rolls back", async () => {
    const key = `${owner}-rollback`;
    await sql`INSERT INTO pointup_chatgpt_transactions VALUES (${key}, ${JSON.stringify({ state: "rollback" })}::jsonb, now() + interval '10 minutes')`;
    await expect(sql.begin(async (tx) => {
      expect(await tx`DELETE FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${key} RETURNING transaction_data`).toHaveLength(1);
      throw new Error("fixture rollback");
    })).rejects.toThrow("fixture rollback");
    expect(await sql`DELETE FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${key} RETURNING transaction_data`).toHaveLength(1);
  });

  it("prevents subject reassignment and a second subject for the same user/client", async () => {
    const client = "fixture-client";
    const link = (subject: string, userId: string) => sql`INSERT INTO pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id)
      VALUES (${owner}, ${client}, ${subject}, ${userId})
      ON CONFLICT (issuer, client_id, subject) DO UPDATE SET clerk_user_id = pointup_chatgpt_identities.clerk_user_id
      WHERE pointup_chatgpt_identities.clerk_user_id = ${userId} RETURNING clerk_user_id`;
    expect(await link("subject-a", owner)).toHaveLength(1);
    expect(await link("subject-a", owner)).toHaveLength(1);
    expect(await link("subject-a", "different-owner")).toHaveLength(0);
    await expect(link("subject-b", owner)).rejects.toMatchObject({ code: "23505" });
    const rows = await sql`SELECT subject, clerk_user_id FROM pointup_chatgpt_identities WHERE issuer = ${owner}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clerk_user_id).toBe(owner);
  });

  it("denies nonprivileged access and enforces RLS even after accidental table grants", async () => {
    const key = `${owner}-rls`;
    await sql`INSERT INTO pointup_chatgpt_transactions VALUES (${key}, ${JSON.stringify({ state: "private" })}::jsonb, now() + interval '10 minutes')`;
    await sql`INSERT INTO pointup_chatgpt_identities (issuer, client_id, subject, clerk_user_id) VALUES (${owner}, 'rls-client', 'rls-subject', ${owner})`;
    const asBrowser = (query: string) => sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${browserRole}`);
      return tx.unsafe(query);
    });
    await expect(asBrowser("SELECT * FROM pointup_chatgpt_transactions")).rejects.toMatchObject({ code: "42501" });
    await expect(asBrowser("SELECT * FROM pointup_chatgpt_identities")).rejects.toMatchObject({ code: "42501" });
    await sql.unsafe(`GRANT SELECT, INSERT, DELETE ON pointup_chatgpt_transactions, pointup_chatgpt_identities TO ${browserRole}`);
    expect(await asBrowser("SELECT * FROM pointup_chatgpt_transactions")).toHaveLength(0);
    expect(await asBrowser("SELECT * FROM pointup_chatgpt_identities")).toHaveLength(0);
    expect(await asBrowser("DELETE FROM pointup_chatgpt_transactions RETURNING browser_id_hash")).toHaveLength(0);
    expect(await asBrowser("DELETE FROM pointup_chatgpt_identities RETURNING subject")).toHaveLength(0);
    await expect(asBrowser("INSERT INTO pointup_chatgpt_transactions VALUES ('browser-forbidden', '{}', now())")).rejects.toMatchObject({ code: "42501" });
    expect(await sql`SELECT browser_id_hash FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${key}`).toHaveLength(1);
    expect(await sql`SELECT subject FROM pointup_chatgpt_identities WHERE issuer = ${owner} AND client_id = 'rls-client'`).toHaveLength(1);
  });
});
