import { describe, expect, it } from "vitest";

import { BuildPortfolioDigest } from "../src/application/loyalty/build-portfolio-digest";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

describe("BuildPortfolioDigest", () => {
  it("composes the summary with accounts ordered by estimated value", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();

    // hilton at 0.5 cpp is worth less than united at 1.2 cpp despite more points.
    const hilton = createLoyaltyAccount({
      userId: "user-1",
      providerId: "hilton",
      membershipNumber: "HH1",
    });
    const united = createLoyaltyAccount({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP1",
    });
    accounts.rows.set(hilton.id, hilton);
    accounts.rows.set(united.id, united);

    balances.rows.push(
      createBalanceSnapshot({
        loyaltyAccountId: hilton.id,
        points: 20_000,
        source: "sync",
        capturedAt: new Date(2026, 0, 1),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: united.id,
        points: 15_000,
        source: "sync",
        capturedAt: new Date(2026, 0, 2),
      }),
    );

    const digest = await new BuildPortfolioDigest(
      new ListLoyaltyAccounts(accounts, balances),
    ).execute("user-1");

    expect(digest.userId).toBe("user-1");
    expect(digest.goals).toEqual([]);
    expect(digest.expiring).toEqual([]);
    expect(digest.summary.accountCount).toBe(2);
    // united: 15000 * 1.2 = 18000 cents; hilton: 20000 * 0.5 = 10000 cents.
    expect(digest.accounts.map((a) => a.provider.id)).toEqual([
      "united",
      "hilton",
    ]);
    expect(digest.summary.totalValueCents).toBe(28_000);
  });

  it("lists distinct user ids for batch jobs", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    for (const [userId, providerId] of [
      ["user-1", "united"],
      ["user-1", "hilton"],
      ["user-2", "delta"],
    ] as const) {
      const account = createLoyaltyAccount({
        userId,
        providerId,
        membershipNumber: "X1",
      });
      accounts.rows.set(account.id, account);
    }

    expect((await accounts.listUserIds()).sort()).toEqual([
      "user-1",
      "user-2",
    ]);
  });
});
