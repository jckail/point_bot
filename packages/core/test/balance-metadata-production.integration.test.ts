import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { buildDrizzleRepositories } from "../src/composition/repositories";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { UserId } from "../src/domain/shared/ids";
import { createDb } from "../src/infrastructure/db/client";
import { assertMigrationConnectionString } from "../src/infrastructure/db/migrations";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("production balance metadata and outbox atomicity", () => {
  const prefix = `balance-metadata-${randomUUID()}`;
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    assertMigrationConnectionString(url!);
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/app" || parsed.username !== "postgres") {
      throw new Error("Balance metadata tests require the dedicated loopback postgres/app fixture.");
    }
    db = createDb(url!, { max: 6 });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!db) return;
    try {
      for (const table of ["domain_event_outbox", "activity_event", "loyalty_account"]) {
        await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE user_id LIKE ${prefix + "%"}`);
      }
    } finally { await db.$client.end({ timeout: 5 }); }
  });

  async function fixture(expiry: Date | null) {
    const userId = UserId.parse(`${prefix}-${randomUUID()}`);
    let current = new Date("2026-10-02T12:00:00Z");
    const clock = { now: () => new Date(current) };
    const repos = buildDrizzleRepositories(db);
    const eventing = repos.eventing;
    if (!eventing?.unitOfWork.atomic) throw new Error("Fixture requires production atomic eventing.");
    const account = {
      ...createLoyaltyAccount({ userId, providerId: "hyatt", membershipNumber: "synthetic",
        now: new Date("2026-08-01T12:00:00Z"), expiresAt: expiry }),
      updatedAt: new Date("2026-10-01T12:00:00Z"),
    };
    await repos.loyaltyAccounts.insert(account);
    const baseline = createBalanceSnapshot({ loyaltyAccountId: account.id, points: 500,
      source: "sync", capturedAt: account.updatedAt });
    await repos.balanceSnapshots.insert(baseline);
    const record = new RecordManualBalance(repos.loyaltyAccounts, repos.balanceSnapshots,
      repos.activity, clock, eventing);
    const sync = new SyncLoyaltyAccount(repos.loyaltyAccounts, repos.balanceSnapshots,
      { supports: () => true, fetchBalance: async () => ({ points: 700 }) },
      { resolve: async () => null }, repos.activity, clock, eventing);
    const counts = async () => {
      const [row] = await db.$client<{ snapshots: number; activity: number; events: number }[]>`
        SELECT (SELECT count(*)::int FROM balance_snapshot WHERE loyalty_account_id=${account.id}) AS snapshots,
          (SELECT count(*)::int FROM activity_event WHERE user_id=${userId}) AS activity,
          (SELECT count(*)::int FROM domain_event_outbox WHERE user_id=${userId}) AS events`;
      if (!row) throw new Error("Missing fixture counts.");
      return row;
    };
    return { userId, account, baseline, repos, eventing, record, sync, clock, counts,
      advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); } };
  }

  const explicitExpiry = new Date("2029-01-01T12:00:00Z");
  const capturedAt = new Date("2026-09-01T12:00:00Z");

  it.each([
    { source: "manual" as const, expiry: explicitExpiry },
    { source: "agent" as const, expiry: explicitExpiry },
    { source: "manual" as const, expiry: null },
    { source: "agent" as const, expiry: null },
  ])("preserves $source backfill expiry $expiry with exact provenance", async ({ source, expiry }) => {
    const f = await fixture(expiry);
    const result = await f.record.executeWithSnapshotId({ userId: f.userId, accountId: f.account.id,
      points: 100, source, capturedAt });
    const stored = await f.repos.loyaltyAccounts.findById(f.account.id);
    expect(stored).toMatchObject({ expiresAt: expiry, updatedAt: f.clock.now() });
    expect((await f.repos.balanceSnapshots.findLatestByAccountIds([f.account.id])).get(f.account.id)?.id).toBe(f.baseline.id);
    expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toContainEqual(
      expect.objectContaining({ id: result.snapshotId, points: 100, source, capturedAt }));
    const activity = await db.$client<{ type: string; occurred_at: string }[]>`
      SELECT type, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at
      FROM activity_event WHERE user_id=${f.userId}`;
    expect(activity).toEqual([{ type: source === "agent" ? "balance_agent" : "balance_manual", occurred_at: capturedAt.toISOString() }]);
    const events = await db.$client<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM domain_event_outbox WHERE user_id=${f.userId}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ source, points: 100, previousPoints: 500,
      capturedAt: capturedAt.toISOString() });
    expect(await f.counts()).toEqual({ snapshots: 2, activity: 1, events: 1 });
  });

  it.each(["manual", "agent"] as const)("rolls back every staged %s backfill effect after an outbox write fails", async source => {
    const f = await fixture(explicitExpiry);
    const beforeAccount = await f.repos.loyaltyAccounts.findById(f.account.id);
    const beforeCounts = await f.counts();
    const publish = f.eventing.publisher.publish.bind(f.eventing.publisher);
    const fault = vi.spyOn(f.eventing.publisher, "publish").mockImplementationOnce(async events => {
      await publish(events);
      // These reads join the real ambient transaction, proving effects were staged.
      expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toMatchObject({ updatedAt: f.clock.now() });
      expect(await f.repos.balanceSnapshots.findByAccountId(f.account.id, 10)).toHaveLength(2);
      throw new Error("Synthetic balance outbox failure");
    });
    try {
      await expect(f.record.execute({ userId: f.userId, accountId: f.account.id,
        points: 100, source, capturedAt })).rejects.toThrow("Synthetic balance outbox failure");
    } finally { fault.mockRestore(); }
    expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toEqual(beforeAccount);
    expect(await f.counts()).toEqual(beforeCounts);
  });

  it("rolls back sync expiry, metadata, snapshot, activity and inserted outbox on publisher failure", async () => {
    const f = await fixture(null);
    const beforeAccount = await f.repos.loyaltyAccounts.findById(f.account.id);
    const beforeCounts = await f.counts();
    const publish = f.eventing.publisher.publish.bind(f.eventing.publisher);
    const fault = vi.spyOn(f.eventing.publisher, "publish").mockImplementationOnce(async events => {
      await publish(events);
      expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toMatchObject({
        updatedAt: f.clock.now(), expiresAt: new Date("2028-10-02T12:00:00Z"),
      });
      throw new Error("Synthetic sync outbox failure");
    });
    try { await expect(f.sync.execute({ userId: f.userId, accountId: f.account.id })).rejects.toThrow("Synthetic sync outbox failure"); }
    finally { fault.mockRestore(); }
    expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toEqual(beforeAccount);
    expect(await f.counts()).toEqual(beforeCounts);
  });

  it("sync preserves an expiry committed while its old captured reading waits on the account lock", async () => {
    const f = await fixture(null);
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { acquired = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    let blockerPid = 0;
    const newerMetadata = new Date(f.clock.now().getTime() + 1000);
    const finished = db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM loyalty_account WHERE id=${f.account.id} FOR UPDATE`);
      const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      if (!row) throw new Error("Missing blocker PID.");
      blockerPid = row.pid;
      acquired();
      await unlock;
      await tx.execute(sql`UPDATE loyalty_account SET expires_at=${explicitExpiry.toISOString()}::timestamptz,
        updated_at=${newerMetadata.toISOString()}::timestamptz WHERE id=${f.account.id}`);
    });
    await held;
    const syncing = f.sync.execute({ userId: f.userId, accountId: f.account.id });
    let result;
    try {
      await vi.waitFor(async () => {
        const [row] = await db.$client<{ blocked: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
            AND ${blockerPid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        expect(row?.blocked).toBe(true);
      }, { timeout: 3000, interval: 10 });
      f.advance(2000);
    } finally { release(); await finished; result = await syncing; }
    expect(result).toMatchObject({ points: 700, source: "sync", capturedAt: new Date("2026-10-02T12:00:00Z") });
    expect(await f.repos.loyaltyAccounts.findById(f.account.id)).toMatchObject({
      expiresAt: explicitExpiry, updatedAt: f.clock.now(),
    });
    expect(await f.counts()).toEqual({ snapshots: 2, activity: 1, events: 1 });
  });
});
