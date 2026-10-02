import { describe, expect, it } from "vitest";

import { ChatWithAssistant, GetValueAdvice } from "../src/application/loyalty/assistant";
import { IngestDealPage } from "../src/application/loyalty/ingest-deal-page";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { HeuristicAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import { StubPageScraper } from "../src/infrastructure/scraper/firecrawl-page-scraper";
import { rankTransferOptions } from "../src/domain/loyalty/transfer-ranking";
import { rankDeals, CATALOG_DEALS } from "../src/domain/loyalty/deals";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryTripGoalRepository,
} from "./fakes";
import type { LlmAssistant } from "../src/application/ports";

import { asTransferBonusId, asUserId } from "./ids";
describe("transfer partner graph", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const hyattBonus = createTransferBonus({
    id: asTransferBonusId("b1"),
    fromProviderId: "chase-ultimate-rewards",
    toProviderId: "hyatt",
    multiplierPermille: 1300,
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-10-31T00:00:00Z"),
    source: "manual",
    now,
  });

  it("shows no bonus by default (nothing is invented)", () => {
    const options = rankTransferOptions("chase-ultimate-rewards", 100_000);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.bonusMultiplier).toBe(1);
      expect(option.bonusLabel).toBeNull();
    }
  });

  it("applies an injected Hyatt bonus and ranks partners by effective cpp", () => {
    const options = rankTransferOptions(
      "chase-ultimate-rewards",
      100_000,
      [hyattBonus],
      now,
    );
    const hyatt = options.find((o) => o.to.id === "hyatt");
    const marriott = options.find((o) => o.to.id === "marriott");
    expect(hyatt).toBeDefined();
    expect(marriott).toBeDefined();
    expect(hyatt!.bonusMultiplier).toBe(1.3);
    expect(hyatt!.destinationPoints).toBe(130_000);
    expect(hyatt!.bonusLabel).toBe("+30% bonus until 2026-10-31");
    expect(hyatt!.effectiveCentsPerPoint).toBeGreaterThan(
      marriott!.effectiveCentsPerPoint,
    );
    expect(options[0]!.effectiveCentsPerPoint).toBeGreaterThanOrEqual(
      options[options.length - 1]!.effectiveCentsPerPoint,
    );
  });

  it("ignores bonuses outside their window", () => {
    const options = rankTransferOptions(
      "chase-ultimate-rewards",
      100_000,
      [hyattBonus],
      new Date("2026-11-15T00:00:00Z"),
    );
    expect(options.find((o) => o.to.id === "hyatt")!.bonusMultiplier).toBe(1);
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
      userId: asUserId("user-1"),
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
    ).execute(asUserId("user-1"));

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
      userId: asUserId("user-1"),
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
      userId: asUserId("user-1"),
      title: "Kyoto",
      targetPoints: 70_000,
      accountIds: [],
    });

    const result = await new ChatWithAssistant(
      new ListLoyaltyAccounts(accounts, balances),
      new ListTripGoals(goals, balances),
      new HeuristicAssistant(),
    ).execute({
      userId: asUserId("user-1"),
      message: "What's my best transfer right now?",
    });

    expect(result.reply.toLowerCase()).toMatch(/transfer|hyatt|united|chase/);
    expect(result.context.summary.totalPoints).toBe(80_000);
  });

  it("maps LLM failures to ASSISTANT_UNAVAILABLE", async () => {
    const failing: LlmAssistant = {
      async complete() {
        throw Object.assign(new Error("PRIVATE_PROVIDER_BODY"), { name: "PRIVATE_PROVIDER_NAME", data: "PRIVATE_ACCOUNT_DATA" });
      },
    };
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();

    await expect(
      new ChatWithAssistant(
        new ListLoyaltyAccounts(accounts, balances),
        new ListTripGoals(new InMemoryTripGoalRepository(), balances),
        failing,
      ).execute({ userId: asUserId("user-1"), message: "hello" }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_UNAVAILABLE",
      message: "Assistant unavailable: Please try again later.",
    });
  });
});
