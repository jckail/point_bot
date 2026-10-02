import { describe, expect, it, vi } from "vitest";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { UserId } from "../src/domain/shared/ids";
import { InMemoryActivityEventRepository, InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, RecordingEventing } from "./fakes";

const now = new Date("2026-10-02T12:00:00Z");
async function fixture(expiry: Date | null, updatedAt = new Date("2026-10-01T12:00:00Z")) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const events = new RecordingEventing();
  const account = { ...createLoyaltyAccount({ userId: UserId.parse("backfill-owner"), providerId: "hyatt", membershipNumber: "synthetic", now: new Date("2026-08-01T12:00:00Z"), expiresAt: expiry }), updatedAt };
  await accounts.insert(account);
  let locked = false;
  const lockById = vi.fn(async () => { locked = true; return accounts.findById(account.id); });
  const scopedAccounts = Object.assign(accounts, { lockById });
  const originalLatest = balances.findLatestByAccountIds.bind(balances);
  vi.spyOn(balances, "findLatestByAccountIds").mockImplementation(async ids => {
    expect(locked).toBe(true);
    return originalLatest(ids);
  });
  const record = new RecordManualBalance(scopedAccounts, balances, activity, { now: () => now }, events);
  return { accounts, balances, activity, events, account, record, lockById };
}

describe("manual and agent backfill metadata policy", () => {
  it.each(["manual", "agent"] as const)("preserves explicit expiry on %s backfill while retaining snapshot/activity/event provenance", async source => {
    const expiry = new Date("2029-01-01T12:00:00Z");
    const f = await fixture(expiry);
    const latest = createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 500, source: "sync", capturedAt: new Date("2026-10-01T12:00:00Z") });
    await f.balances.insert(latest);
    const capturedAt = new Date("2026-09-01T12:00:00Z");
    const result = await f.record.executeWithSnapshotId({ userId: f.account.userId, accountId: f.account.id, points: 100, capturedAt, source });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: expiry, updatedAt: now });
    expect((await f.balances.findLatestByAccountIds([f.account.id])).get(f.account.id)?.id).toBe(latest.id);
    expect(f.balances.rows.find(row => row.id === result.snapshotId)).toMatchObject({ points: 100, capturedAt, source });
    expect([...f.activity.rows.values()]).toContainEqual(expect.objectContaining({ type: source === "agent" ? "balance_agent" : "balance_manual", occurredAt: capturedAt }));
    expect(f.events.events).toHaveLength(1);
    expect(f.events.events[0]).toMatchObject({ type: "balance.recorded", occurredAt: now, payload: { points: 100, previousPoints: 500, capturedAt: capturedAt.toISOString(), source } });
  });
  it("preserves cleared expiry even when a backfill becomes the latest available reading", async () => {
    const f = await fixture(null);
    await f.record.execute({ userId: f.account.userId, accountId: f.account.id, points: 100, capturedAt: new Date("2026-09-01T12:00:00Z") });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: null, updatedAt: now });
  });
  it("checks the latest capture independently of the account metadata timestamp", async () => {
    const expiry = new Date("2029-01-01T12:00:00Z");
    const f = await fixture(expiry, new Date("2026-08-01T12:00:00Z"));
    await f.balances.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 500, source: "sync", capturedAt: new Date("2026-10-01T12:00:00Z") }));
    await f.record.execute({ userId: f.account.userId, accountId: f.account.id, points: 100, capturedAt: new Date("2026-09-01T12:00:00Z") });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: expiry, updatedAt: now });
  });
  it.each(["manual", "agent"] as const)("retains PR14 expiry refresh for a forward %s reading", async source => {
    const f = await fixture(null);
    await f.record.execute({ userId: f.account.userId, accountId: f.account.id, points: 100, source });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: new Date("2028-10-02T12:00:00Z"), updatedAt: now });
  });
  it("uses fresh transaction mutation time for a forward captured timestamp", async () => {
    const f = await fixture(null, new Date("2026-09-01T12:00:00Z"));
    const capturedAt = new Date("2026-10-01T12:00:00Z");
    const clocks = [now, new Date("2026-10-02T12:00:01Z")];
    const record = new RecordManualBalance(f.accounts, f.balances, undefined, { now: () => clocks.shift()! }, f.events);
    await record.execute({ userId: f.account.userId, accountId: f.account.id, points: 100, capturedAt });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: new Date("2028-10-01T12:00:00Z"), updatedAt: new Date("2026-10-02T12:00:01Z") });
  });
  it("preserves a stored future metadata timestamp deliberately instead of repairing it with a reading", async () => {
    const future = new Date("2027-01-01T12:00:00Z");
    const expiry = new Date("2029-01-01T12:00:00Z");
    const f = await fixture(expiry, future);
    await f.record.execute({ userId: f.account.userId, accountId: f.account.id, points: 100 });
    expect(await f.accounts.findById(f.account.id)).toMatchObject({ expiresAt: expiry, updatedAt: future });
  });
});
