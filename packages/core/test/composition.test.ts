import { describe, expect, it } from "vitest";

import { StubPageScraper } from "../src/infrastructure/scraper/firecrawl-page-scraper";
import { HeuristicAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import { NullCredentialVault } from "../src/infrastructure/vault/null-credential-vault";
import { StaticFxRateSource } from "../src/infrastructure/fx/fx-rate-sources";
import { buildAgentModule } from "../src/composition/agent-module";
import { buildLoyaltyModule } from "../src/composition/loyalty-module";
import {
  selectFx,
  selectLlm,
  selectScraper,
  selectVault,
} from "../src/composition/adapters";
import type { Repositories } from "../src/composition/repositories";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import {
  InMemoryActivityEventRepository,
  InMemoryAwardWatchRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryCustomValuationRepository,
  InMemoryLoyaltyAccountRepository,
  InMemoryPortfolioShareRepository,
  InMemoryTripGoalRepository,
  InMemoryUserSettingsRepository,
} from "./fakes";

function repos(): Repositories {
  const loyaltyAccounts = new InMemoryLoyaltyAccountRepository();
  return {
    loyaltyAccounts,
    balanceSnapshots: new InMemoryBalanceSnapshotRepository(),
    activity: new InMemoryActivityEventRepository(),
    tripGoals: new InMemoryTripGoalRepository(),
    shares: new InMemoryPortfolioShareRepository(),
    customValuations: new InMemoryCustomValuationRepository(),
    awardWatches: new InMemoryAwardWatchRepository(),
    settings: new InMemoryUserSettingsRepository(),
    // Agent persistence is exercised in agent.test.ts; wiring only here.
    accessTokens: {} as Repositories["accessTokens"],
    consents: {} as Repositories["consents"],
    observations: {} as Repositories["observations"],
  };
}

describe("composition modules", () => {
  it("wires loyalty use cases that work end to end over ports", async () => {
    const r = repos();
    const loyalty = buildLoyaltyModule({
      repos: r,
      gateway: new SimulatedTravelProviderGateway(),
      vault: new NullCredentialVault(),
      fx: new StaticFxRateSource(),
      scraper: new StubPageScraper(),
      llm: new HeuristicAssistant(),
    });

    await loyalty.linkLoyaltyAccount.execute({
      userId: "u1",
      providerId: "united",
      membershipNumber: "123",
    });
    const accounts = await loyalty.listLoyaltyAccounts.execute("u1");
    expect(accounts).toHaveLength(1);
    expect(await loyalty.listActivity.execute("u1")).toHaveLength(1);
    expect(loyalty.checkAwardWatches).toBeDefined();
    expect(loyalty.buildPortfolioDigest).toBeDefined();
  });

  it("wires the agent module on top of loyalty write-back use cases", () => {
    const r = repos();
    const loyalty = buildLoyaltyModule({
      repos: r,
      gateway: new SimulatedTravelProviderGateway(),
      vault: new NullCredentialVault(),
      fx: new StaticFxRateSource(),
      scraper: new StubPageScraper(),
      llm: new HeuristicAssistant(),
    });
    const agent = buildAgentModule({
      repos: r,
      recordManualBalance: loyalty.recordManualBalance,
      linkLoyaltyAccount: loyalty.linkLoyaltyAccount,
    });
    expect(Object.keys(agent).sort()).toEqual([
      "authenticateAccessToken",
      "grantConsent",
      "issueAccessToken",
      "listAccessTokens",
      "listAgentObservations",
      "listAgentSkills",
      "listConsents",
      "revokeAccessToken",
      "revokeConsent",
      "submitObservation",
    ]);
  });

  it("selects adapters from plain config", () => {
    expect(selectVault({})).toBeInstanceOf(NullCredentialVault);
    expect(selectLlm({})).toBeInstanceOf(HeuristicAssistant);
    expect(selectScraper({})).toBeInstanceOf(StubPageScraper);
    expect(selectFx({})).toBeInstanceOf(StaticFxRateSource);
  });
});
