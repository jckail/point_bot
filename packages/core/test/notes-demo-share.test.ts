import { describe, expect, it } from "vitest";

import { BuildPortfolioDigest } from "../src/application/loyalty/build-portfolio-digest";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { SeedDemoPortfolio } from "../src/application/loyalty/seed-demo-portfolio";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import {
  CreatePortfolioShare,
  GetPublicPortfolioSnapshot,
} from "../src/application/loyalty/portfolio-share";
import {
  DemoPortfolioNotEmptyError,
  ShareLinkNotFoundError,
} from "../src/domain/errors";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryPortfolioShareRepository,
  InMemoryTripGoalRepository,
} from "./fakes";

describe("BuildPortfolioDigest", () => {
  it("includes active goals and expiring accounts", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();

    const hyatt = createLoyaltyAccount({
      userId: "user-1",
      providerId: "hyatt",
      membershipNumber: "HY1",
      expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });
    await accounts.insert(hyatt);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: hyatt.id,
        points: 40_000,
        source: "manual",
        capturedAt: new Date(),
      }),
    );

    await new CreateTripGoal(goals, accounts, balances).execute({
      userId: "user-1",
      title: "Kyoto",
      targetPoints: 70_000,
      accountIds: [hyatt.id],
    });

    const digest = await new BuildPortfolioDigest(
      new ListLoyaltyAccounts(accounts, balances),
      new ListTripGoals(goals, balances),
    ).execute("user-1");

    expect(digest.goals).toHaveLength(1);
    expect(digest.goals[0]?.percentComplete).toBeGreaterThan(0);
    expect(digest.expiring).toHaveLength(1);
  });
});

describe("SeedDemoPortfolio", () => {
  it("seeds accounts, balances, and a sample goal", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();
    const link = new LinkLoyaltyAccount(accounts);
    const record = new RecordManualBalance(accounts, balances);
    const createGoal = new CreateTripGoal(goals, accounts, balances);

    const result = await new SeedDemoPortfolio(
      accounts,
      link,
      record,
      createGoal,
    ).execute("user-1");

    expect(result.accountIds.length).toBe(5);
    expect(result.goalId).not.toBeNull();
    expect(await accounts.findByUserId("user-1")).toHaveLength(5);
  });

  it("refuses to seed when the portfolio is not empty", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    await accounts.insert(
      createLoyaltyAccount({
        userId: "user-1",
        providerId: "united",
        membershipNumber: "X",
      }),
    );

    await expect(
      new SeedDemoPortfolio(
        accounts,
        new LinkLoyaltyAccount(accounts),
        new RecordManualBalance(
          accounts,
          new InMemoryBalanceSnapshotRepository(),
        ),
      ).execute("user-1"),
    ).rejects.toBeInstanceOf(DemoPortfolioNotEmptyError);
  });
});

describe("PortfolioShare", () => {
  it("creates a public snapshot without membership numbers", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const shares = new InMemoryPortfolioShareRepository();

    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "SECRET-MP",
    });
    await accounts.insert(account);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: 10_000,
        source: "manual",
        capturedAt: new Date(),
      }),
    );

    const share = await new CreatePortfolioShare(shares).execute({
      userId: "user-1",
      label: "Friends",
      expiresInDays: 30,
    });

    const snapshot = await new GetPublicPortfolioSnapshot(
      shares,
      new ListLoyaltyAccounts(accounts, balances),
    ).execute(share.token);

    expect(snapshot.label).toBe("Friends");
    expect(snapshot.totalPoints).toBe(10_000);
    expect(JSON.stringify(snapshot)).not.toContain("SECRET-MP");
    expect(snapshot.programs[0]?.displayName).toContain("United");
  });

  it("rejects unknown tokens", async () => {
    await expect(
      new GetPublicPortfolioSnapshot(
        new InMemoryPortfolioShareRepository(),
        new ListLoyaltyAccounts(
          new InMemoryLoyaltyAccountRepository(),
          new InMemoryBalanceSnapshotRepository(),
        ),
      ).execute("nope"),
    ).rejects.toBeInstanceOf(ShareLinkNotFoundError);
  });
});
