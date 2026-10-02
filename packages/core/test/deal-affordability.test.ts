import { describe, expect, it } from "vitest";
import { GetValueAdvice } from "../src/application/loyalty/assistant";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListActiveTransferBonuses } from "../src/application/loyalty/transfer-bonuses";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import { CATALOG_DEALS, type DealCandidate } from "../src/domain/loyalty/deals";
import type { CardProductId } from "../src/domain/loyalty/card-products";
import { toValueAdviceDto, valueAdviceDtoSchema } from "../src/contracts/index";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTransferBonusRepository } from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("deal-owner"), now = new Date("2026-10-02T12:00:00Z");
type Account = { providerId: string; points: number; cardProductId?: CardProductId | null };
async function fixture(accounts: Account[], date = now) {
  const accountRepo = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository();
  const bonusRepo = new InMemoryTransferBonusRepository(), clock = { now: () => date };
  for (const input of accounts) {
    const account = createLoyaltyAccount({ ...input, userId: owner, membershipNumber: "synthetic" });
    await accountRepo.insert(account);
    await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: input.points, source: "manual", capturedAt: date }));
  }
  const service = new GetValueAdvice(new ListLoyaltyAccounts(accountRepo, balances, clock), new ListActiveTransferBonuses(bonusRepo, clock), clock);
  return { bonusRepo, advice: (extra: DealCandidate[] = []) => service.execute(owner, extra) };
}
function chase(points: number, cardProductId: CardProductId | null = "chase-sapphire-preferred"): Account {
  return { providerId: "chase-ultimate-rewards", points, cardProductId };
}
const find = (advice: Awaited<ReturnType<GetValueAdvice["execute"]>>, id: string) => advice.deals.find(deal => deal.deal.id === id)!;
const hyattId = "deal-hyatt-off-peak-cat1";

describe("owned-card deal affordability", () => {
  it("3500 affected Chase points cannot afford 3500 Hyatt; source requirement uses exact inverse 4:3", async () => {
    const f = await fixture([chase(3500)]);
    const advice = await f.advice();
    expect(find(advice, hyattId)).toMatchObject({ affordable: false, transferRequirement: {
      sourcePointsRequired: 4667, sourcePointsAvailable: 3500, destinationPointsNeeded: 3500, destinationPointsProduced: 3500,
      ratioFrom: 4, ratioTo: 3, minimumSourcePoints: null, incrementSourcePoints: null, limitsVerified: false,
      eligibility: { cardProductId: "chase-sapphire-preferred", evaluatedAt: now.toISOString() },
    } });
    const enough = await (await fixture([chase(4667)])).advice();
    expect(find(enough, hyattId).affordable).toBe(true);
    expect(find(enough, hyattId).affordabilityNote).toMatch(/4,667.*4:3.*Estimate only/);
  });
  it.each([null, "chase-sapphire-reserve"] as const)("does not allow unknown/unverified card %s despite a large source balance", async cardProductId => {
    const advice = await (await fixture([chase(80000, cardProductId)])).advice();
    const deal = find(advice, hyattId);
    expect(deal).toMatchObject({ affordable: false, transferRequirement: null });
    expect(deal.eligibilityWarnings).toHaveLength(1);
    expect(deal.eligibilityWarnings?.[0]?.cardProductId).toBe(cardProductId);
    expect(advice.eligibilityWarnings).toHaveLength(1);
  });
  it("8000 Chase points do not afford an Amtrak deal without a graph route", async () => {
    const advice = await (await fixture([chase(8000)])).advice();
    expect(find(advice, "deal-amtrak-flex")).toMatchObject({ affordable: false, transferRequirement: null, transferUnavailableReason: "NO_TRANSFER_ROUTE" });
  });
  it("40000 Amex points can afford 80000 Hilton points at 1:2 without spurious Chase warnings", async () => {
    const advice = await (await fixture([{ providerId: "amex-membership-rewards", points: 40000 }])).advice();
    expect(find(advice, "deal-hilton-aspirational")).toMatchObject({ affordable: true, transferRequirement: {
      sourcePointsRequired: 40000, destinationPointsProduced: 80000, ratioFrom: 1, ratioTo: 2,
    } });
    expect(advice.eligibilityWarnings).toEqual([]);
  });
  it("uses visible active bonuses, two-stage floors and truthful unverified bonus metadata", async () => {
    const f = await fixture([chase(4000)]);
    for (const [createdBy, multiplierPermille, startsAt, endsAt] of [
      [asUserId("foreign"), 2000, new Date("2026-10-01"), new Date("2026-10-04")],
      [owner, 1300, new Date("2026-10-01"), new Date("2026-10-04")],
      [owner, 1900, new Date("2026-09-01"), new Date("2026-09-04")],
    ] as const) await f.bonusRepo.insert(createTransferBonus({ fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt",
      source: "user", createdBy, multiplierPermille, startsAt, endsAt, now }));
    expect(find(await f.advice(), hyattId)).toMatchObject({ affordable: true, transferRequirement: {
      sourcePointsRequired: 3591, destinationPointsProduced: 3500, bonusPermille: 1300, bonusVerified: false,
    } });
    expect(find(await f.advice(), hyattId).affordabilityNote).toContain("unverified");
    const noBonus = await (await fixture([chase(4000)])).advice();
    expect(find(noBonus, hyattId).affordable).toBe(false);
  });
  it("preserves direct destination affordability regardless of unknown source selection", async () => {
    const advice = await (await fixture([chase(3500, null), { providerId: "hyatt", points: 3500 }, { providerId: "amtrak", points: 8000 }])).advice();
    expect(find(advice, hyattId)).toMatchObject({ affordable: true, transferRequirement: null, eligibilityWarnings: [] });
    expect(find(advice, "deal-amtrak-flex")).toMatchObject({ affordable: true, transferRequirement: null });
  });
  it("uses a partial direct destination balance without assuming cards can be combined", async () => {
    const advice = await (await fixture([chase(3500), { providerId: "hyatt", points: 1000 }])).advice();
    expect(find(advice, hyattId)).toMatchObject({ affordable: true, transferRequirement: { sourcePointsRequired: 3334, destinationPointsNeeded: 2500 } });
    expect(find(advice, hyattId).affordabilityNote).toContain("Use 1,000 saved destination points");
    expect(find(advice, hyattId).transferRequirement?.caveats.join(" ")).toContain("No cards are combined automatically");
  });
  it("shares effective-date eligibility and applies known catalog increments without inventing unknown ones", async () => {
    const before = await (await fixture([chase(5000)], new Date("2026-09-30T23:59:59.999Z"))).advice();
    expect(find(before, hyattId)).toMatchObject({ affordable: false, transferUnavailableReason: "TRANSFER_RULE_NOT_EFFECTIVE" });
    const united = { ...CATALOG_DEALS.find(deal => deal.providerId === "united")!, id: "odd-united-cost", pointsCost: 10501 };
    const advice = await (await fixture([chase(10501)])).advice([united]);
    expect(find(advice, united.id)).toMatchObject({ affordable: false, transferRequirement: { sourcePointsRequired: 11000, incrementSourcePoints: 1000, limitsVerified: false } });
  });
  it("fails closed when inverse funding cannot fit a safe integer", async () => {
    const huge = { ...CATALOG_DEALS.find(deal => deal.id === hyattId)!, id: "huge", pointsCost: Number.MAX_SAFE_INTEGER };
    const advice = await (await fixture([chase(40000)])).advice([huge]);
    expect(find(advice, huge.id)).toMatchObject({ affordable: false, transferRequirement: null, transferUnavailableReason: "AMOUNT_OUT_OF_RANGE" });
  });
  it("carries actual requirements and warnings through the public advice contract", async () => {
    for (const card of ["chase-sapphire-preferred", null] as const) {
      const advice = await (await fixture([chase(3500, card)])).advice();
      const wire = valueAdviceDtoSchema.parse(toValueAdviceDto(advice));
      const deal = wire.deals.find(deal => deal.deal.id === hyattId)!;
      expect(deal.transferRequirement).toEqual(find(advice, hyattId).transferRequirement);
      expect(deal.eligibilityWarnings).toEqual(find(advice, hyattId).eligibilityWarnings);
      expect(deal.affordable).toBe(false);
    }
    expect(valueAdviceDtoSchema.safeParse({ transfers: [], deals: [{ deal: CATALOG_DEALS[0], realizedCentsPerPoint: 1,
      affordable: false, affordabilityNote: "legacy", score: 1 }] }).success).toBe(true);
  });
});
