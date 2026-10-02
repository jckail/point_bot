import { describe, expect, it } from "vitest";
import { resolveTransferEdge, type TransferAccountContext } from "../src/domain/loyalty/transfer-eligibility";
import { convertPoints, edgeRatio, findTransferEdge } from "../src/domain/loyalty/transfer-partners";
import { rankTransferAdvice } from "../src/domain/loyalty/transfer-ranking";
import { optimizeRedemptions, type Holding } from "../src/domain/loyalty/optimizer";
import { findSweetSpot } from "../src/domain/loyalty/catalog/sweet-spots";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import { asTransferBonusId } from "./ids";

const now = new Date("2026-10-01T00:00:00Z");
const raw = findTransferEdge("chase-ultimate-rewards", "hyatt")!;
const context = { cardProductId: "chase-sapphire-preferred" } as const;
function resolved(account: TransferAccountContext = context, date = now) {
  const result = resolveTransferEdge(raw, account, date);
  if (result.status !== "resolved") throw new Error("Expected eligible fixture");
  return result.edge;
}
const holding: Holding = { providerId: "chase-ultimate-rewards", points: 40000, centsPerPoint: 2,
  daysUntilExpiry: null, ...context };
const spot = { ...findSweetSpot("hyatt-cat1-4-standard")!, pointsCost: 40000, pointsCostMin: 40000, pointsCostMax: 40000 };
const bonus = createTransferBonus({ id: asTransferBonusId("eligibility-bonus"), fromProviderId: raw.fromProviderId,
  toProviderId: raw.toProviderId, multiplierPermille: 1300, startsAt: now,
  endsAt: new Date("2026-11-01T00:00:00Z"), source: "manual", now });
function plan(holdings: Holding[] = [holding], bonuses = [] as typeof bonus[]) {
  return optimizeRedemptions({ holdings, bonuses, now, sweetSpots: [spot],
    goal: { kind: "hotel", targetProgramId: "hyatt", quantity: 1 } });
}

describe("card-aware transfer calculations", () => {
  it.each(["chase-sapphire-preferred", "chase-ink-business-preferred", "chase-ink-plus", "chase-corporate-flex"] as const)("resolves %s to 4:3 on the verified date", cardProductId => {
    const edge = resolved({ cardProductId });
    expect(convertPoints(edge, 40000)).toBe(30000);
    expect(edgeRatio(edge)).toEqual({ num: 3, den: 4 });
    expect(edge.eligibility).toMatchObject({ cardProductId, effectiveFrom: now.toISOString(), evaluatedAt: now.toISOString() });
    expect(edge.eligibility.sourceUrl).toMatch(/^https:\/\/(?:media\.)?chase.com\//);
  });
  it("refuses raw and cloned conditional edges even when callers forge metadata or ratios", () => {
    expect(() => convertPoints(raw, 40000)).toThrow();
    expect(() => edgeRatio(raw)).toThrow();
    expect(() => convertPoints({ ...resolved(), ratioTo: 4 }, 40000)).toThrow();
    expect(Object.isFrozen(resolved())).toBe(true);
  });
  it("excludes unknown, unverified and pre-effective rules with actionable warnings", () => {
    for (const account of [{}, { cardProductId: null }, { cardProductId: "chase-sapphire-reserve" }] as TransferAccountContext[]) {
      const advice = rankTransferAdvice(raw.fromProviderId, 40000, [], now, account);
      expect(advice.options.some(option => option.to.id === "hyatt")).toBe(false);
      expect(advice.options.some(option => option.to.id === "united")).toBe(true);
      expect(advice.eligibilityWarnings).toHaveLength(1);
      expect(advice.eligibilityWarnings[0]?.message).toMatch(/select|check/i);
    }
    expect(resolveTransferEdge(raw, context, new Date("2026-09-30T23:59:59.999Z"))).toMatchObject({ status: "unavailable", warning: { code: "TRANSFER_RULE_NOT_EFFECTIVE" } });
    expect(() => resolved(context, new Date("invalid"))).toThrow();
  });
  it("ranking, funding, inverse shortfall and displayed steps use the same 4:3 rule", () => {
    const advice = rankTransferAdvice(raw.fromProviderId, 40000, [], now, context);
    expect(advice.options.find(option => option.to.id === "hyatt")?.destinationPoints).toBe(30000);
    const result = plan();
    const p = result.plans[0]!;
    expect(p).toMatchObject({ status: "shortfall", destinationPointsProvided: 30000, destinationPointsNeeded: 40000,
      shortfall: { pointsNeeded: 10000 } });
    expect(p.shortfall?.coverage.find(hint => hint.providerId === raw.fromProviderId)).toMatchObject({ sourcePointsNeeded: 14000, balanceAvailable: 0, canCoverNow: false });
    expect(p.steps[0]?.text).toContain("4:3");
    expect(p.sources[0]?.eligibility).toEqual(resolved().eligibility);
    const funded = plan([{ ...holding, points: 54000 }]).plans[0]!;
    expect(funded).toMatchObject({ status: "fundable", destinationPointsProvided: 40500, totalSourcePoints: 54000 });
  });
  it("composes two-stage bonus floors and transfer blocks with the resolved ratio", () => {
    expect(convertPoints(resolved(), 40001, 1300)).toBe(39000);
    expect(rankTransferAdvice(raw.fromProviderId, 40001, [bonus], now, context).options.find(option => option.to.id === "hyatt")?.destinationPoints).toBe(39000);
    const p = plan([{ ...holding, points: 40999 }], [bonus]).plans[0]!;
    expect(p).toMatchObject({ status: "shortfall", totalSourcePoints: 40000, destinationPointsProvided: 39000, shortfall: { pointsNeeded: 1000 } });
    expect(p.shortfall?.coverage.find(hint => hint.providerId === raw.fromProviderId)?.sourcePointsNeeded).toBe(2000);
    expect(plan([{ ...holding, points: 42000 }], [bonus]).plans[0]).toMatchObject({ status: "fundable", totalSourcePoints: 42000, destinationPointsProvided: 40950 });
  });
  it("unknown cards contribute no conditional funding/coverage while direct Hyatt remains usable", () => {
    const unknown = plan([{ ...holding, cardProductId: null }]);
    expect(unknown.plans[0]).toMatchObject({ status: "shortfall", destinationPointsProvided: 0, sources: [] });
    expect(unknown.plans[0]?.shortfall?.coverage.some(hint => hint.providerId === raw.fromProviderId)).toBe(false);
    expect(unknown.eligibilityWarnings[0]?.code).toBe("CARD_PRODUCT_REQUIRED");
    expect(unknown.plans[0]?.eligibilityWarnings).toEqual(unknown.eligibilityWarnings);
    expect(plan([{ ...holding, providerId: "hyatt", cardProductId: null }]).plans[0]).toMatchObject({ status: "fundable", destinationPointsProvided: 40000 });
    expect(convertPoints(findTransferEdge("bilt", "hyatt")!, 40000)).toBe(40000);
  });
});
