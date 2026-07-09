import { describe, expect, it } from "vitest";

import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { ListActivity } from "../src/application/loyalty/list-activity";
import { ListExpiringAccounts } from "../src/application/loyalty/list-expiring-accounts";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { projectExpiryDate } from "../src/domain/loyalty/provider";
import { findProvider } from "../src/domain/loyalty/provider";
import {
  InMemoryActivityEventRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

const NOW = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => NOW };

describe("expiration tracking", () => {
  it("projects expiry from the catalog policy on link", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const activity = new InMemoryActivityEventRepository();
    const result = await new LinkLoyaltyAccount(
      accounts,
      activity,
      clock,
    ).execute({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP1",
    });

    const stored = await accounts.findById(result.accountId);
    const united = findProvider("united")!;
    expect(stored?.expiresAt).toEqual(projectExpiryDate(united, NOW));
    expect(activity.rows[0]?.type).toBe("account_linked");
  });

  it("leaves expiry null for programs that never expire", () => {
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "delta",
      membershipNumber: "SK1",
      now: NOW,
    });
    expect(account.expiresAt).toBeNull();
  });

  it("lists accounts expiring within the warning window", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();

    const soon = createLoyaltyAccount({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP1",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    const later = createLoyaltyAccount({
      userId: "user-1",
      providerId: "american",
      membershipNumber: "AA1",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      now: NOW,
    });
    const never = createLoyaltyAccount({
      userId: "user-1",
      providerId: "bilt",
      membershipNumber: "BL1",
      now: NOW,
    });
    accounts.rows.set(soon.id, soon);
    accounts.rows.set(later.id, later);
    accounts.rows.set(never.id, never);

    const expiring = await new ListExpiringAccounts(
      new ListLoyaltyAccounts(accounts, balances, clock),
    ).execute("user-1", 90);

    expect(expiring.map((a) => a.provider.id)).toEqual(["united"]);
    expect(expiring[0]?.daysUntilExpiry).toBeGreaterThan(0);
  });

  it("refreshes expiry when a manual balance is recorded", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const activity = new InMemoryActivityEventRepository();
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "hyatt",
      membershipNumber: "WH1",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    accounts.rows.set(account.id, account);

    await new RecordManualBalance(
      accounts,
      balances,
      activity,
      clock,
    ).execute({
      userId: "user-1",
      accountId: account.id,
      points: 10_000,
    });

    const updated = await accounts.findById(account.id);
    const hyatt = findProvider("hyatt")!;
    expect(updated?.expiresAt).toEqual(projectExpiryDate(hyatt, NOW));
    expect(activity.rows[0]?.type).toBe("balance_manual");
  });
});

describe("activity feed", () => {
  it("returns newest events first", async () => {
    const activity = new InMemoryActivityEventRepository();
    await new LinkLoyaltyAccount(new InMemoryLoyaltyAccountRepository(), activity, clock).execute({
      userId: "user-1",
      providerId: "hilton",
      membershipNumber: "HH1",
    });

    const feed = await new ListActivity(activity).execute("user-1");
    expect(feed).toHaveLength(1);
    expect(feed[0]?.type).toBe("account_linked");
    expect(feed[0]?.summary).toContain("Hilton");
  });
});
