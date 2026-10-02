import { createHash, randomUUID } from "node:crypto";
import { createDb, UserId, type Database } from "@pointup/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTransaction, OPENAI_ISSUER } from "./oidc";

const container = vi.hoisted((): { db?: Database } => ({}));
vi.mock("../container", () => ({ getContainer: () => {
  if (!container.db) throw new Error("PostgreSQL fixture has not initialized its shared handle.");
  return { db: container.db };
} }));
import { consumeTransaction, linkedIdentity, linkIdentity, saveTransaction } from "./storage";

// CI applies managed migrations first. Never opt in via DATABASE_URL or app env.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const browserHash = (value: string) => createHash("sha256").update(value).digest("hex");

suite("SIWC storage on dedicated PostgreSQL", () => {
  const prefix = `siwc-storage-${randomUUID()}`;
  const clientId = `oaiapp_${prefix}`;
  const browserIds: string[] = [];
  let db: Database | undefined;
  const owner = (name: string) => UserId.parse(`${prefix}-${name}`);
  const identity = (subject: string) => ({ issuer: OPENAI_ISSUER, clientId, subject: `${prefix}-${subject}` });
  const browser = () => {
    const id = `${prefix}-${randomUUID()}`;
    browserIds.push(id);
    return id;
  };
  const transaction = (name: string) => createTransaction(owner(name), "https://synthetic.pointup.test/api/auth/chatgpt/callback");
  const database = () => {
    if (!db) throw new Error("PostgreSQL fixture has not initialized its shared handle.");
    return db;
  };

  beforeAll(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL is required.");
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)
      || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || decodeURIComponent(parsed.username) !== "postgres"
      || parsed.searchParams.get("pgbouncer") === "true" || ["6432", "6543"].includes(parsed.port)) {
      throw new Error("SIWC integration tests require the dedicated direct loopback postgres/app fixture.");
    }
    db = createDb(url, { max: 6 });
    container.db = db;
    const tables = await db.execute<{ transactions: string | null; identities: string | null }>(sql`SELECT
      to_regclass('public.pointup_chatgpt_transactions')::text AS transactions,
      to_regclass('public.pointup_chatgpt_identities')::text AS identities`);
    expect(tables[0]?.transactions).toBe("pointup_chatgpt_transactions");
    expect(tables[0]?.identities).toBe("pointup_chatgpt_identities");
  });

  afterAll(async () => {
    if (!db) return;
    try {
      // Only this suite's exact client/hashed browser identifiers are removed.
      await db.execute(sql`DELETE FROM pointup_chatgpt_identities WHERE client_id = ${clientId} AND issuer = ${OPENAI_ISSUER}`);
      for (const browserId of browserIds) {
        await db.execute(sql`DELETE FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${browserHash(browserId)}`);
      }
    } finally {
      container.db = undefined;
      await db.$client.end({ timeout: 5 });
    }
  });

  it("round-trips the actual driver's bound JSON, Date and browser hash", async () => {
    const browserId = browser();
    const saved = transaction("encoding");
    await saveTransaction(browserId, saved);
    const rows = await database().execute<{ browser_id_hash: string; transaction_data: typeof saved; expires_at: Date | string }>(sql`SELECT browser_id_hash, transaction_data, expires_at
      FROM pointup_chatgpt_transactions WHERE browser_id_hash = ${browserHash(browserId)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.browser_id_hash).toBe(browserHash(browserId));
    expect(rows[0]?.browser_id_hash).not.toBe(browserId);
    expect(rows[0]?.transaction_data).toEqual(saved);
    expect(new Date(rows[0]!.expires_at).getTime()).toBe(saved.expiresAt);
    await expect(consumeTransaction(browserId)).resolves.toEqual(saved);
  });

  it("allows exactly one concurrent consumer and makes later replay missing", async () => {
    const browserId = browser();
    const saved = transaction("consume-race");
    await saveTransaction(browserId, saved);
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => consumeTransaction(browserId)));
    expect(outcomes.filter(value => value !== null)).toEqual([saved]);
    expect(outcomes.filter(value => value === null)).toHaveLength(5);
    await expect(consumeTransaction(browserId)).resolves.toBeNull();
  });

  it("keeps same-owner linking idempotent and rejects reassignment to another owner", async () => {
    const subject = identity("idempotent");
    const original = owner("idempotent");
    await linkIdentity(subject, original);
    await linkIdentity(subject, original);
    expect(await linkedIdentity(original, clientId, OPENAI_ISSUER)).toBe(true);
    await expect(linkIdentity(subject, owner("foreign"))).rejects.toThrow("could not be linked");
    expect(await linkedIdentity(owner("foreign"), clientId, OPENAI_ISSUER)).toBe(false);
    const rows = await database().execute<{ clerk_user_id: string }>(sql`SELECT clerk_user_id FROM pointup_chatgpt_identities
      WHERE issuer = ${OPENAI_ISSUER} AND client_id = ${clientId} AND subject = ${subject.subject}`);
    expect(rows).toEqual([expect.objectContaining({ clerk_user_id: original })]);
  });

  it("does not replace an existing owner's identity", async () => {
    const original = owner("no-replacement");
    const first = identity("first-link");
    await linkIdentity(first, original);
    await expect(linkIdentity(identity("replacement"), original)).rejects.toThrow();
    const rows = await database().execute<{ subject: string }>(sql`SELECT subject FROM pointup_chatgpt_identities
      WHERE issuer = ${OPENAI_ISSUER} AND client_id = ${clientId} AND clerk_user_id = ${original}`);
    expect(rows).toEqual([expect.objectContaining({ subject: first.subject })]);
  });

  it("allows one of two competing subjects to claim an owner's unique mapping", async () => {
    const original = owner("owner-race");
    const candidates = [identity("owner-race-first"), identity("owner-race-second")];
    const outcomes = await Promise.allSettled(candidates.map(candidate => linkIdentity(candidate, original)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const rows = await database().execute<{ subject: string }>(sql`SELECT subject FROM pointup_chatgpt_identities
      WHERE issuer = ${OPENAI_ISSUER} AND client_id = ${clientId} AND clerk_user_id = ${original}`);
    expect(rows).toHaveLength(1);
    expect(candidates.map(candidate => candidate.subject)).toContain(rows[0]?.subject);
  });

  it("allows only one owner to claim an unlinked subject concurrently", async () => {
    const subject = identity("subject-race");
    const owners = [owner("subject-race-first"), owner("subject-race-second")];
    const outcomes = await Promise.allSettled(owners.map(candidate => linkIdentity(subject, candidate)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const rows = await database().execute<{ clerk_user_id: string }>(sql`SELECT clerk_user_id FROM pointup_chatgpt_identities
      WHERE issuer = ${OPENAI_ISSUER} AND client_id = ${clientId} AND subject = ${subject.subject}`);
    expect(rows).toHaveLength(1);
    expect(owners).toContain(rows[0]?.clerk_user_id);
  });

  it("removes expired transactions without deleting another owner's valid flow", async () => {
    const expiredId = browser();
    const validId = browser();
    const newId = browser();
    const expired = transaction("expired");
    expired.expiresAt = Date.now() - 60_000;
    const valid = transaction("valid-other-owner");
    // Saving the expired row last leaves it present until the next start cleanup.
    await saveTransaction(validId, valid);
    await saveTransaction(expiredId, expired);
    await saveTransaction(newId, transaction("new-start"));
    await expect(consumeTransaction(expiredId)).resolves.toBeNull();
    await expect(consumeTransaction(validId)).resolves.toEqual(valid);
  });
});
