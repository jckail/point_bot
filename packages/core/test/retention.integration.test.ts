import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/infrastructure/db/schema";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";
import type { RetentionTarget } from "../src/infrastructure/retention/retention";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/infrastructure/db/client";
import {
  accessTokens,
  activityEvents,
  agentObservations,
  balanceSnapshots,
  consentGrants,
  domainEventOutbox,
  loyaltyAccounts,
} from "../src/infrastructure/db/schema";
import { DrizzleRetentionStore } from "../src/infrastructure/retention/drizzle-retention-repository";
import {
  DEFAULT_RETENTION_POLICY,
  purgeExpired,
} from "../src/infrastructure/retention/retention";

/**
 * Retention against a real, migrated Postgres (TEST_DATABASE_URL). Rows are
 * isolated in owned schemas cloned from migrated table definitions. Purges
 * cannot reach public fixtures, even when other suites create old rows.
 */
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe.skipIf(!url)("retention purge on Postgres", () => {
  let admin: ReturnType<typeof createDb>;
  let db: ReturnType<typeof createDb>;
  let store: DrizzleRetentionStore;
  const clients: ReturnType<typeof postgres>[] = [];
  const schemas: string[] = [];
  const tables = ["domain_event_outbox", "activity_event", "access_token", "consent_grant", "loyalty_account", "balance_snapshot", "agent_observation"] as const;
  async function isolatedFixture() {
    const name = `pointup_retention_fixture_${crypto.randomUUID().replaceAll("-", "")}`;
    schemas.push(name);
    await admin.$client.unsafe(`CREATE SCHEMA "${name}"`);
    for (const table of tables) {
      await admin.$client.unsafe(`CREATE TABLE "${name}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // Pin every pooled connection to our own tables and force the adverse
    // nested-loop plan that can rescan a non-materialized locking selector.
    const client = postgres(url!, { max: 4, connection: { search_path: name,
      enable_hashjoin: "off", enable_mergejoin: "off", enable_material: "off", enable_nestloop: "on" }, onnotice: () => {} });
    clients.push(client);
    const scoped = drizzle(client, { schema });
    expect((await client`SELECT current_schema() AS name`)[0]?.name).toBe(name);
    return { db: scoped, store: new DrizzleRetentionStore(scoped) };
  }
  const p = `ret-${crypto.randomUUID().slice(0, 8)}`;
  const id = (name: string) => `${p}-${name}`;
  const user = id("user");

  const outbox = (name: string, extra: Partial<typeof domainEventOutbox.$inferInsert>) => ({
    id: id(name),
    type: "balance.recorded",
    userId: user,
    aggregateId: id("agg"),
    payload: {},
    occurredAt: daysAgo(400),
    availableAt: daysAgo(400),
    ...extra,
  });

  async function remaining(table: "outbox" | "activity" | "tokens" | "consents") {
    const t = {
      outbox: domainEventOutbox,
      activity: activityEvents,
      tokens: accessTokens,
      consents: consentGrants,
    }[table];
    const rows = await db
      .select({ id: t.id })
      .from(t)
      .where(sql`${t.id} like ${`${p}-%`}`);
    return rows.map((r) => r.id).sort();
  }

  beforeAll(async () => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Retention tests require the dedicated loopback postgres/app fixture.");
    }
    admin = createDb(url!, { max: 2 });
    ({ db, store } = await isolatedFixture());
    await db.insert(domainEventOutbox).values([
      outbox("ob-old-processed", { processedAt: daysAgo(30) }),
      outbox("ob-old-processed-2", { processedAt: daysAgo(15) }),
      outbox("ob-recent-processed", { processedAt: daysAgo(2) }),
      outbox("ob-old-dead", { deadLetteredAt: daysAgo(60), attempts: 8 }),
      outbox("ob-old-pending", {}),
    ]);
    await db.insert(activityEvents).values([
      { id: id("act-old"), userId: user, type: "balance_recorded", summary: "old", occurredAt: daysAgo(400) },
      { id: id("act-new"), userId: user, type: "balance_recorded", summary: "new", occurredAt: daysAgo(10) },
    ]);
    const token = (name: string, extra: Partial<typeof accessTokens.$inferInsert>) => ({
      id: id(name),
      userId: user,
      name,
      displayPrefix: "pu_x",
      tokenHash: `${p}-hash-${name}`,
      scopes: "portfolio:read",
      createdAt: daysAgo(500),
      ...extra,
    });
    await db.insert(accessTokens).values([
      token("tok-expired-old", { expiresAt: daysAgo(100) }),
      token("tok-revoked-old", { revokedAt: daysAgo(100) }),
      token("tok-expired-recent", { expiresAt: daysAgo(30) }),
      token("tok-revoked-recent", { revokedAt: daysAgo(5) }),
      token("tok-active", { expiresAt: new Date(NOW.getTime() + 86_400_000) }),
      token("tok-no-expiry", {}),
    ]);
    await db.insert(consentGrants).values([
      { id: id("con-expired-old"), userId: user, providerId: "united", grantedAt: daysAgo(900), expiresAt: daysAgo(400) },
      { id: id("con-revoked-old"), userId: user, providerId: "hyatt", grantedAt: daysAgo(900), expiresAt: new Date(NOW.getTime() + 86_400_000), revokedAt: daysAgo(400) },
      { id: id("con-expired-recent"), userId: user, providerId: "delta", grantedAt: daysAgo(500), expiresAt: daysAgo(100) },
      { id: id("con-active"), userId: user, providerId: "marriott", grantedAt: daysAgo(5), expiresAt: new Date(NOW.getTime() + 86_400_000) },
    ]);
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      for (const client of clients) await client.end({ timeout: 5 });
      for (const name of schemas) {
        if (!/^pointup_retention_fixture_[a-f0-9]{32}$/.test(name)) throw new Error("Refusing to remove an unowned retention schema.");
        await admin.$client.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      }
    } finally { await admin.$client.end({ timeout: 5 }); }
  });

  it("purges only what the policy allows, per table", async () => {
    const result = await purgeExpired(store, DEFAULT_RETENTION_POLICY, NOW);
    expect(result.targets.every((t) => !t.error)).toBe(true);

    expect(await remaining("outbox")).toEqual(
      [id("ob-recent-processed"), id("ob-old-dead"), id("ob-old-pending")].sort(),
    );
    expect(await remaining("activity")).toEqual([id("act-new")]);
    expect(await remaining("tokens")).toEqual(
      [id("tok-expired-recent"), id("tok-revoked-recent"), id("tok-active"), id("tok-no-expiry")].sort(),
    );
    expect(await remaining("consents")).toEqual(
      [id("con-expired-recent"), id("con-active")].sort(),
    );
  });

  it("is idempotent: a second run finds nothing of ours", async () => {
    const result = await purgeExpired(store, DEFAULT_RETENTION_POLICY, NOW);
    expect(result.targets.every((t) => !t.error)).toBe(true);
    expect(await remaining("outbox")).toHaveLength(3);
  });

  it("honours batch size and run cap, and concurrent purges never double-delete", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => id(`bulk-${String(i).padStart(2, "0")}`));
    const seed = () =>
      db.insert(domainEventOutbox).values(
        ids.map((x) => outbox(x.slice(p.length + 1), { processedAt: daysAgo(40) })),
      );
    await seed();

    const small = await purgeExpired(
      store,
      { ...DEFAULT_RETENTION_POLICY, batchSize: 10, maxRowsPerRun: 20 },
      NOW,
    );
    const ob = small.targets.find((t) => t.target === "outbox")!;
    expect(ob).toMatchObject({ deleted: 20, batches: 2, capped: true });
    const left = await db.select({ id: domainEventOutbox.id }).from(domainEventOutbox).where(inArray(domainEventOutbox.id, ids));
    expect(left).toHaveLength(5);

    await db.delete(domainEventOutbox).where(inArray(domainEventOutbox.id, ids));
    await seed();
    const runs = await Promise.all(
      Array.from({ length: 4 }, () =>
        purgeExpired(store, { ...DEFAULT_RETENTION_POLICY, batchSize: 3 }, NOW),
      ),
    );
    const deletedByOutbox = runs.reduce(
      (sum, r) => sum + r.targets.find((t) => t.target === "outbox")!.deleted,
      0,
    );
    expect(deletedByOutbox).toBe(25); // each row deleted exactly once across workers
    expect(await db.select({ id: domainEventOutbox.id }).from(domainEventOutbox).where(inArray(domainEventOutbox.id, ids))).toHaveLength(0);
  });

  it("never touches balance snapshots or agent observations", async () => {
    const accountId = id("acct");
    await db.insert(loyaltyAccounts).values({
      id: accountId,
      userId: user,
      providerId: "united",
      membershipNumber: "X1",
      createdAt: daysAgo(900),
      updatedAt: daysAgo(900),
    } as typeof loyaltyAccounts.$inferInsert);
    await db.insert(balanceSnapshots).values({
      id: id("snap"),
      loyaltyAccountId: accountId,
      points: 100,
      source: "sync",
      capturedAt: daysAgo(800),
    } as typeof balanceSnapshots.$inferInsert);
    await db.insert(agentObservations).values({
      id: id("obs"),
      userId: user,
      accountId,
      providerId: "united",
      skillId: "united.capture-balance",
      agent: "t",
      sourceHost: "united.com",
      points: 100,
      outcome: "recorded",
      observedAt: daysAgo(800),
      createdAt: daysAgo(800),
    } as typeof agentObservations.$inferInsert);

    await purgeExpired(store, DEFAULT_RETENTION_POLICY, NOW);

    expect(await db.select({ id: balanceSnapshots.id }).from(balanceSnapshots).where(eq(balanceSnapshots.id, id("snap")))).toHaveLength(1);
    expect(await db.select({ id: agentObservations.id }).from(agentObservations).where(eq(agentObservations.id, id("obs")))).toHaveLength(1);
  });

  const targetTables = { outbox: domainEventOutbox, activity: activityEvents, access_tokens: accessTokens, consents: consentGrants };
  async function seedTarget(target: RetentionTarget, scoped: ReturnType<typeof createDb>, prefix: string) {
    const ids = Array.from({ length: 25 }, (_, i) => `${prefix}-${i}`);
    if (target === "outbox") await scoped.insert(domainEventOutbox).values(ids.map(id => ({ id, type: "balance.recorded", userId: user, aggregateId: id, payload: {}, occurredAt: daysAgo(500), availableAt: daysAgo(500), processedAt: daysAgo(400) })));
    if (target === "activity") await scoped.insert(activityEvents).values(ids.map(id => ({ id, userId: user, type: "balance_recorded", summary: "synthetic old activity", occurredAt: daysAgo(500) })));
    if (target === "access_tokens") await scoped.insert(accessTokens).values(ids.map(id => ({ id, userId: user, name: "synthetic", displayPrefix: "pu_x", tokenHash: id, scopes: "portfolio:read", createdAt: daysAgo(900), expiresAt: daysAgo(500) })));
    if (target === "consents") await scoped.insert(consentGrants).values(ids.map(id => ({ id, userId: user, providerId: "united", grantedAt: daysAgo(900), expiresAt: daysAgo(500), revokedAt: daysAgo(500) })));
    return ids;
  }

  it.each(["outbox", "activity", "access_tokens", "consents"] as const)("bounds %s under nested-loop planning and enforces the run cap", async target => {
    const f = await isolatedFixture();
    const table = targetTables[target];
    await seedTarget(target, f.db, `${p}-direct-${target}`);
    for (const limit of [1, 3, 5]) {
      const before = (await f.db.select({ id: table.id }).from(table)).length;
      expect(await f.store.purgeBatch(target, daysAgo(90), limit)).toBe(limit);
      expect((await f.db.select({ id: table.id }).from(table)).length).toBe(before - limit);
    }
    await f.db.delete(table);
    await seedTarget(target, f.db, `${p}-cap-${target}`);
    const capped = await purgeExpired(f.store, { ...DEFAULT_RETENTION_POLICY, batchSize: 10, maxRowsPerRun: 20 }, NOW);
    expect(capped.targets.find(result => result.target === target)).toMatchObject({ deleted: 20, batches: 2, capped: true });
    expect(capped.targets.every(result => !result.error)).toBe(true);
    expect(await f.db.select({ id: table.id }).from(table)).toHaveLength(5);
  });

  it.each(["outbox", "activity", "access_tokens", "consents"] as const)("concurrent capped %s workers claim each row at most once", async target => {
    const f = await isolatedFixture();
    const table = targetTables[target];
    await seedTarget(target, f.db, `${p}-concurrent-${target}`);
    const runs = await Promise.all(Array.from({ length: 4 }, () => purgeExpired(f.store,
      { ...DEFAULT_RETENTION_POLICY, batchSize: 3, maxRowsPerRun: 6 }, NOW)));
    const receipts = runs.map(run => run.targets.find(result => result.target === target)!);
    for (const receipt of receipts) {
      expect(receipt.error).toBeUndefined();
      expect(receipt.deleted).toBeLessThanOrEqual(6);
    }
    const deleted = receipts.reduce((sum, receipt) => sum + receipt.deleted, 0);
    expect(deleted).toBeGreaterThan(0);
    expect(deleted).toBeLessThanOrEqual(24);
    expect(await f.db.select({ id: table.id }).from(table)).toHaveLength(25 - deleted);
    const drained = await purgeExpired(f.store, { ...DEFAULT_RETENTION_POLICY, batchSize: 3 }, NOW);
    expect(drained.targets.every(result => !result.error)).toBe(true);
    expect(deleted + drained.targets.find(result => result.target === target)!.deleted).toBe(25);
    expect(await f.db.select({ id: table.id }).from(table)).toHaveLength(0);
  });

});
