import { describe, expect, it, vi } from "vitest";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import type { Eventing } from "../src/application/events/ports";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { UserId } from "../src/domain/shared/ids";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository } from "./fakes";

const now = new Date("2026-10-02T12:00:00Z");

describe("locked manual balance and snapshot provenance", () => {
  it("returns the actual inserted backfill ID while preserving execute's public shape", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({ userId: UserId.parse("backfill-owner"), providerId: "united", membershipNumber: "synthetic", now });
    await accounts.insert(account);
    const newest = createBalanceSnapshot({ loyaltyAccountId: account.id, points: 500, source: "manual", capturedAt: now });
    await balances.insert(newest);
    const record = new RecordManualBalance(accounts, balances, undefined, { now: () => now });
    const capturedAt = new Date("2026-09-01T12:00:00Z");
    const result = await record.executeWithSnapshotId({ userId: account.userId, accountId: account.id, points: 100, capturedAt, source: "agent" });
    expect(result.snapshotId).not.toBe(newest.id);
    expect((await balances.findByAccountId(account.id, 10)).find(row => row.id === result.snapshotId)).toMatchObject({ points: 100, source: "agent", capturedAt });
    expect((await balances.findLatestByAccountIds([account.id])).get(account.id)?.id).toBe(newest.id);
    expect(await record.execute({ userId: account.userId, accountId: account.id, points: 200, capturedAt })).toEqual({ points: 200, source: "manual", capturedAt });
  });

  it("reloads account state inside the UOW lock and rejects deletion before any effects", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({ userId: UserId.parse("lock-owner"), providerId: "united", membershipNumber: "synthetic", now });
    await accounts.insert(account);
    let inside = false;
    const lockedAccounts = Object.assign(accounts, { lockById: vi.fn(async () => {
      expect(inside).toBe(true);
      return { ...account, deletedAt: now };
    }) });
    const publish = vi.fn(async () => {});
    const eventing: Eventing = { unitOfWork: { atomic: true, async run(work) {
      inside = true;
      try { return await work(); } finally { inside = false; }
    } }, publisher: { publish } };
    const record = new RecordManualBalance(lockedAccounts, balances, undefined, { now: () => now }, eventing);
    await expect(record.execute({ userId: account.userId, accountId: account.id, points: 100 })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(await balances.findByAccountId(account.id, 10)).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
