import { describe, expect, it, vi } from "vitest";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { CredentialUnavailableError, LoyaltyAccountNotFoundError } from "../src/domain/errors";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import type { LoyaltyAccountId } from "../src/domain/shared/ids";
import { FakeCredentialVault, InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, RecordingEventing } from "./fakes";
import { asUserId } from "./ids";

const now = new Date("2026-01-01T12:00:00Z");
class LockedAccounts extends InMemoryLoyaltyAccountRepository {
  beforeLock: () => Promise<void> = async () => {};
  async lockById(id: LoyaltyAccountId) {
    await this.beforeLock();
    return this.findById(id);
  }
}

async function fixture() {
  const accounts = new LockedAccounts();
  const balances = new InMemoryBalanceSnapshotRepository();
  const eventing = new RecordingEventing();
  const account = createLoyaltyAccount({ userId: asUserId("sync-owner"), providerId: "united", membershipNumber: "synthetic", now });
  await accounts.insert(account);
  const fetchBalance = vi.fn(async () => ({ points: 500 }));
  const sync = new SyncLoyaltyAccount(accounts, balances, { supports: () => true, fetchBalance }, new FakeCredentialVault(), undefined, { now: () => now }, eventing);
  return { accounts, balances, eventing, account, fetchBalance, sync, input: { userId: account.userId, accountId: account.id } };
}

describe("sync write boundary after provider IO", () => {
  it("reads the serialized baseline and preserves metadata changed while fetching or waiting", async () => {
    const f = await fixture();
    f.fetchBalance.mockImplementation(async () => {
      await f.accounts.update({ ...f.account, notes: "Updated during provider fetch", tags: ["travel"], pinnedAt: now });
      return { points: 500 };
    });
    f.accounts.beforeLock = async () => {
      await f.balances.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 250, source: "manual", capturedAt: now }));
    };
    await f.sync.execute(f.input);
    const saved = await f.accounts.findById(f.account.id);
    expect(saved).toMatchObject({ notes: "Updated during provider fetch", tags: ["travel"], pinnedAt: now });
    expect(f.eventing.events[0]?.payload).toMatchObject({ previousPoints: 250, points: 500, source: "sync" });
  });

  it("refuses a deleted account after provider IO without writing snapshots or events", async () => {
    const f = await fixture();
    f.accounts.beforeLock = () => f.accounts.update({ ...f.account, deletedAt: now });
    await expect(f.sync.execute(f.input)).rejects.toBeInstanceOf(LoyaltyAccountNotFoundError);
    expect(f.balances.rows).toHaveLength(0);
    expect(f.eventing.events).toHaveLength(0);
  });

  it("does not attach a fetched value to a membership changed before the write lock", async () => {
    const f = await fixture();
    f.accounts.beforeLock = () => f.accounts.update({ ...f.account, membershipNumber: "different-member" });
    await expect(f.sync.execute(f.input)).rejects.toBeInstanceOf(CredentialUnavailableError);
    expect(f.balances.rows).toHaveLength(0);
    expect(f.eventing.events).toHaveLength(0);
  });
});
