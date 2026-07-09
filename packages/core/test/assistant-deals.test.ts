import { describe, expect, it } from "vitest";

import { ChatWithAssistant, GetValueAdvice } from "../src/application/loyalty/assistant";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { HeuristicAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import { StubPageScraper } from "../src/infrastructure/scraper/firecrawl-page-scraper";
import {
  rankTransferOptions,
} from "../src/domain/loyalty/transfer-partners";
import { rankDeals, CATALOG_DEALS } from "../src/domain/loyalty/deals";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryTripGoalRepository,
} from "./fakes";
import type { LlmAssistant } from "../src/application/ports";

describe("transfer partner graph", () => {
  it("applies Hyatt bonus and ranks partners by effective cpp", () => {
    const options = rankTransferOptions("chase-ultimate-rewards", 100_000);
    expect(options.length).toBeGreaterThan(0);

    const hyatt = options.find((o) => o.to.id === "hyatt");
    const hilton = options.find((o) => o.to.id === "hilton");
    expect(hyatt).toBeDefined();
    expect(hilton).toBeDefined();
    expect(hyatt!.bonusMultiplier).toBeGreaterThan(1);
    expect(hyatt!.effectiveCentsPerPoint).toBeGreaterThan(
      hilton!.effectiveCentsPerPoint,
    );
    // Highest editorial cpp partners should lead the list.
    expect(options[0]!.effectiveCentsPerPoint).toBeGreaterThanOrEqual(
      options[options.length - 1]!.effectiveCentsPerPoint,
    );
  });
});

describe("deal ranking", () => {
  it("marks affordable deals and scores high cpp higher", () => {
    const balances = new Map([
      ["hyatt", 50_000],
      ["chase-ultimate-rewards", 200_000],
    ]);
    const editorial = new Map([
      ["hyatt", 1.7],
      ["united", 1.2],
      ["hilton", 0.5],
      ["amtrak", 2.5],
    ]);
    const ranked = rankDeals(CATALOG_DEALS, balances, editorial);
    expect(ranked[0]?.score).toBeGreaterThan(0);
    const hyatt = ranked.find((r) => r.deal.providerId === "hyatt");
    expect(hyatt?.affordable).toBe(true);
  });
});

describe("GetValueAdvice", () => {
  it("returns transfers and deals for a portfolio with UR + Hyatt", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const chase = createLoyaltyAccount({
      userId: "user-1",
      providerId: "chase-ultimate-rewards",
      membershipNumber: "UR1",
    });
    await accounts.insert(chase);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: chase.id,
        points: 120_000,
        source: "manual",
        capturedAt: new Date(),
      }),
    );

    const advice = await new GetValueAdvice(
      new ListLoyaltyAccounts(accounts, balances),
    ).execute("user-1");

    expect(advice.transfers.length).toBeGreaterThan(0);
    expect(advice.deals.length).toBe(CATALOG_DEALS.length);
  });
});

describe("IngestDealPage", () => {
  it("extracts point/cash pairs from stub Hyatt markdown", async () => {
    const result = await new IngestDealPage(new StubPageScraper()).execute({
      url: "https://example.com/hyatt-awards",
    });
    expect(result.pageTitle.toLowerCase()).toContain("hyatt");
    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.some((d) => d.pointsCost === 3_500)).toBe(true);
  });

  it("rejects non-http URLs", async () => {
    await expect(
      new IngestDealPage(new StubPageScraper()).execute({
        url: "ftp://nope",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCRAPE_URL" });
  });
});

describe("ChatWithAssistant", () => {
  it("answers with the heuristic assistant using portfolio context", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const goals = new InMemoryTripGoalRepository();

    const chase = createLoyaltyAccount({
      userId: "user-1",
      providerId: "chase-ultimate-rewards",
      membershipNumber: "UR1",
    });
    await accounts.insert(chase);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: chase.id,
        points: 80_000,
        source: "manual",
        capturedAt: new Date(),
      }),
    );

    await new CreateTripGoal(goals, accounts, balances).execute({
      userId: "user-1",
      title: "Kyoto",
      targetPoints: 70_000,
      accountIds: [],
    });

    const result = await new ChatWithAssistant(
      new ListLoyaltyAccounts(accounts, balances),
      new ListTripGoals(goals, balances),
      new HeuristicAssistant(),
    ).execute({
      userId: "user-1",
      message: "What's my best transfer right now?",
    });

    expect(result.reply.toLowerCase()).toMatch(/transfer|hyatt|united|chase/);
    expect(result.context.summary.totalPoints).toBe(80_000);
  });

  it("maps LLM failures to ASSISTANT_UNAVAILABLE", async () => {
    const failing: LlmAssistant = {
      async complete() {
        throw new Error("boom");
      },
    };
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();

    await expect(
      new ChatWithAssistant(
        new ListLoyaltyAccounts(accounts, balances),
        new ListTripGoals(new InMemoryTripGoalRepository(), balances),
        failing,
      ).execute({ userId: "user-1", message: "hello" }),
    ).rejects.toMatchObject({ code: "ASSISTANT_UNAVAILABLE" });
  });
});
