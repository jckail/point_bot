import { describe, expect, it, vi } from "vitest";
import { assembleAssistantContext, ChatWithAssistant, GetValueAdvice } from "../src/application/loyalty/assistant";
import { PlanRedemption, toHoldings } from "../src/application/loyalty/plan-redemption";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { ListActiveTransferBonuses } from "../src/application/loyalty/transfer-bonuses";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import { rankTransferAdvice } from "../src/domain/loyalty/transfer-ranking";
import { SWEET_SPOTS } from "../src/domain/loyalty/catalog/sweet-spots";
import type { CardProductId } from "../src/domain/loyalty/card-products";
import { StubAwardAvailabilitySource } from "../src/infrastructure/award-search/award-availability-sources";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, InMemoryTransferBonusRepository, InMemoryTripGoalRepository } from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("eligibility-owner");
const now = new Date("2026-10-02T12:00:00Z");
async function fixture(cardProductId: CardProductId | null, bonus = false) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId, now });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 40_000, source: "manual", capturedAt: now }));
  const clock = { now: () => now };
  const list = new ListLoyaltyAccounts(accounts, balances, clock);
  const bonusRepo = new InMemoryTransferBonusRepository();
  if (bonus) await bonusRepo.insert(createTransferBonus({ createdBy: owner, fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt", multiplierPermille: 1300, startsAt: new Date("2026-10-01"), endsAt: new Date("2026-11-01"), source: "user", now }));
  const bonuses = new ListActiveTransferBonuses(bonusRepo, clock);
  const spot = SWEET_SPOTS.find(entry => entry.programId === "hyatt")!;
  const plan = new PlanRedemption(list, bonuses, new StubAwardAvailabilitySource(), clock, [{ ...spot, pointsCost: 40_000, pointsCostMin: 40_000, pointsCostMax: 40_000, maxUnits: 1 }]);
  return { list, bonuses, plan, clock };
}

describe("card eligibility application propagation", () => {
  it("maps explicit product selection into holdings and preserves null for legacy account context", async () => {
    const f = await fixture("chase-sapphire-preferred");
    const models = await f.list.execute(owner);
    expect(toHoldings(models)[0]).toMatchObject({ cardProductId: "chase-sapphire-preferred", points: 40_000 });
    expect(toHoldings(models.map(({ cardProductId: _selection, ...legacy }) => legacy))[0]?.cardProductId).toBeNull();
  });
  it.each([false, true])("advice, hints and funding agree for affected card (bonus %s)", async bonus => {
    const f = await fixture("chase-sapphire-preferred", bonus);
    const advice = await new GetValueAdvice(f.list, f.bonuses, f.clock).execute(owner);
    const context = assembleAssistantContext(await f.list.execute(owner), [], await f.bonuses.execute(owner), now);
    const expected = bonus ? 39_000 : 30_000;
    const resolved = rankTransferAdvice("chase-ultimate-rewards", 40_000, await f.bonuses.execute(owner), now, { cardProductId: "chase-sapphire-preferred" });
    expect(resolved.options.find(option => option.to.id === "hyatt")?.destinationPoints).toBe(expected);
    expect(advice.transfers).toEqual(resolved.options.slice(0, 3));
    for (const option of resolved.options.slice(0, 2)) {
      expect(context.valueHints.some(hint => hint.includes(`${option.destinationPoints.toLocaleString("en-US")} ${option.to.displayName}`))).toBe(true);
    }
    const result = await f.plan.execute({ userId: owner, goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 1 } });
    expect(result.plans.some(plan => plan.status === "fundable")).toBe(false);
  });
  it.each([null, "chase-sapphire-reserve"] as const)("does not invent Hyatt yield for unknown/unverified product %s", async selection => {
    const f = await fixture(selection);
    const advice = await new GetValueAdvice(f.list, f.bonuses, f.clock).execute(owner);
    const context = assembleAssistantContext(await f.list.execute(owner), [], [], now);
    expect(advice.transfers.some(option => option.to.id === "hyatt")).toBe(false);
    expect(context.valueHints.some(hint => hint.includes("Hyatt"))).toBe(false);
    expect(context.eligibilityWarnings).toEqual(advice.eligibilityWarnings);
    expect(advice.eligibilityWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ toProviderId: "hyatt", cardProductId: selection })]));
    const result = await f.plan.execute({ userId: owner, goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 1 } });
    expect(result.eligibilityWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ toProviderId: "hyatt" })]));
    expect(result.plans.some(plan => plan.status === "fundable")).toBe(false);
  });
  it("uses the injected evaluation clock for advice and planning at an unsupported historical date", async () => {
    const f = await fixture("chase-sapphire-preferred");
    f.clock.now = () => new Date("2026-09-30T12:00:00Z");
    const advice = await new GetValueAdvice(f.list, f.bonuses, f.clock).execute(owner);
    const result = await f.plan.execute({ userId: owner, goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 1 } });
    expect(advice.transfers.some(option => option.to.id === "hyatt")).toBe(false);
    expect(advice.eligibilityWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TRANSFER_RULE_NOT_EFFECTIVE", toProviderId: "hyatt" })]));
    expect(result.eligibilityWarnings).toEqual(advice.eligibilityWarnings);
  });
  it("includes fixed eligibility guidance in the actual LLM grounding prompt", async () => {
    const f = await fixture(null);
    const complete = vi.fn().mockResolvedValue("Confirm your transfer card.");
    const llm = { complete };
    const goals = new ListTripGoals(new InMemoryTripGoalRepository(), new InMemoryBalanceSnapshotRepository());
    const result = await new ChatWithAssistant(f.list, goals, llm, f.bonuses, f.clock).execute({ userId: owner, message: "Can I transfer to Hyatt?" });
    expect(result.context.eligibilityWarnings.length).toBeGreaterThan(0);
    expect(complete.mock.calls[0]?.[0].system).toContain(result.context.eligibilityWarnings[0]!.message);
    expect(complete.mock.calls[0]?.[0].system).not.toContain("40,000 World of Hyatt");
  });
});
