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
  InMemoryConsents,
  InMemoryLoyaltyAccountRepository,
  InMemoryPortfolioShareRepository,
  InMemoryTokens,
  InMemoryTransferBonusRepository,
  InMemoryTripGoalRepository,
  InMemoryUserSettingsRepository,
  RecordingEventing,
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
    transferBonuses: new InMemoryTransferBonusRepository(),
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

  it("threads the repositories' eventing into use cases", async () => {
    const r = repos();
    const eventing = new RecordingEventing();
    r.eventing = eventing;
    const loyalty = buildLoyaltyModule({
      repos: r,
      gateway: new SimulatedTravelProviderGateway(),
      vault: new NullCredentialVault(),
      fx: new StaticFxRateSource(),
      scraper: new StubPageScraper(),
      llm: new HeuristicAssistant(),
    });
    const { accountId } = await loyalty.linkLoyaltyAccount.execute({
      userId: "u1",
      providerId: "united",
      membershipNumber: "123",
    });
    await loyalty.recordManualBalance.execute({ userId: "u1", accountId, points: 5 });
    await loyalty.syncLoyaltyAccount.execute({ userId: "u1", accountId });
    await loyalty.updateLoyaltyAccount.execute({ userId: "u1", accountId, notes: "x" });
    await loyalty.unlinkLoyaltyAccount.execute("u1", accountId);
    await loyalty.restoreLoyaltyAccount.execute("u1", accountId);
    const goal = await loyalty.createTripGoal.execute({
      userId: "u1",
      title: "t",
      targetPoints: 10,
    });
    await loyalty.updateTripGoal.execute({ userId: "u1", goalId: goal.id, notes: "n" });
    await loyalty.deleteTripGoal.execute("u1", goal.id);
    expect(eventing.types()).toEqual([
      "account.linked",
      "balance.recorded",
      "balance.recorded",
      "account.updated",
      "account.unlinked",
      "account.restored",
      "goal.created",
      "goal.updated",
      "goal.deleted",
    ]);

    const agent = buildAgentModule({
      repos: { ...r, accessTokens: new InMemoryTokens(), consents: new InMemoryConsents() },
      recordManualBalance: loyalty.recordManualBalance,
      linkLoyaltyAccount: loyalty.linkLoyaltyAccount,
    });
    const issued = await agent.issueAccessToken.execute({
      userId: "u1",
      name: "n",
      scopes: ["portfolio:read"],
    });
    await agent.revokeAccessToken.execute("u1", issued.token.id);
    const consent = await agent.grantConsent.execute({ userId: "u1", providerId: "united" });
    await agent.revokeConsent.execute("u1", consent.id);
    expect(eventing.types().slice(9)).toEqual([
      "token.issued",
      "token.revoked",
      "consent.granted",
      "consent.revoked",
    ]);
  });

  it("works without eventing (hosts that do not configure the outbox)", async () => {
    const loyalty = buildLoyaltyModule({
      repos: repos(),
      gateway: new SimulatedTravelProviderGateway(),
      vault: new NullCredentialVault(),
      fx: new StaticFxRateSource(),
      scraper: new StubPageScraper(),
      llm: new HeuristicAssistant(),
    });
    await expect(
      loyalty.linkLoyaltyAccount.execute({
        userId: "u1",
        providerId: "united",
        membershipNumber: "1",
      }),
    ).resolves.toBeDefined();
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
      "resolveObservationReview",
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
