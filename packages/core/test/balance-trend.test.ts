import { describe, expect, it } from "vitest";

import {
  buildTrendContext,
  computeBalanceTrend,
  computeDelta,
} from "../src/application/loyalty/balance-trend";
import { ExportPortfolio } from "../src/application/loyalty/export-portfolio";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  toPortfolioExportCsv,
  toPortfolioExportDto,
} from "../src/contracts/index";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

const NOW = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => NOW };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("balance trends", () => {
  it("computes absolute and relative deltas", () => {
    expect(computeDelta(12_000, 10_000)).toEqual({ points: 2_000, percent: 0.2 });
    expect(computeDelta(8_000, 10_000)).toEqual({ points: -2_000, percent: -0.2 });
    expect(computeDelta(5_000, 0)).toEqual({ points: 5_000, percent: null });
  });

  it("builds trend context from newest-first history", () => {
    const accountId = "acc-1";
    const snapshots = [
      createBalanceSnapshot({
        loyaltyAccountId: accountId,
        points: 12_000,
        source: "sync",
        capturedAt: daysAgo(1),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: accountId,
        points: 10_000,
        source: "sync",
        capturedAt: daysAgo(10),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: accountId,
        points: 8_000,
        source: "manual",
        capturedAt: daysAgo(40),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: accountId,
        points: 5_000,
        source: "manual",
        capturedAt: daysAgo(100),
      }),
    ];

    const context = buildTrendContext(snapshots, NOW);
    expect(context.latest?.points).toBe(12_000);
    expect(context.previous?.points).toBe(10_000);
    expect(context.asOf30Days?.points).toBe(8_000);
    expect(context.asOf90Days?.points).toBe(5_000);

    const trend = computeBalanceTrend(context);
    expect(trend.sincePrevious).toEqual({ points: 2_000, percent: 0.2 });
    expect(trend.since30Days).toEqual({ points: 4_000, percent: 0.5 });
    expect(trend.since90Days).toEqual({ points: 7_000, percent: 1.4 });
  });

  it("surfaces trends on listed accounts", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP1",
    });
    accounts.rows.set(account.id, account);
    balances.rows.push(
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: 10_000,
        source: "sync",
        capturedAt: daysAgo(5),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: 8_000,
        source: "sync",
        capturedAt: daysAgo(20),
      }),
    );

    const [listed] = await new ListLoyaltyAccounts(
      accounts,
      balances,
      clock,
    ).execute("user-1");

    expect(listed?.trend.sincePrevious).toEqual({
      points: 2_000,
      percent: 0.25,
    });
    expect(listed?.trend.since30Days).toBeNull();
  });
});

describe("ExportPortfolio", () => {
  it("exports accounts with history and serializes to JSON and CSV", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "hilton",
      membershipNumber: "HH1",
    });
    accounts.rows.set(account.id, account);
    balances.rows.push(
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: 20_000,
        source: "manual",
        capturedAt: daysAgo(2),
      }),
    );

    const exported = await new ExportPortfolio(
      accounts,
      balances,
      clock,
    ).execute("user-1");

    expect(exported.accounts).toHaveLength(1);
    expect(exported.accounts[0]?.history).toHaveLength(1);

    const dto = toPortfolioExportDto(exported);
    expect(dto.exportedAt).toBe(NOW.toISOString());
    expect(dto.accounts[0]?.account.trend.sincePrevious).toBeNull();

    const csv = toPortfolioExportCsv(exported);
    expect(csv).toContain("accountId,providerId,providerKind");
    expect(csv).toContain("hilton");
    expect(csv).toContain("20000");
    expect(csv).toContain("manual");
  });
});
