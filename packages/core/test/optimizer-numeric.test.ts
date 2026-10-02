import { describe, expect, it } from "vitest";
import { optimizeRedemptions, type Holding } from "../src/domain/loyalty/optimizer";
import { findSweetSpot } from "../src/domain/loyalty/catalog/sweet-spots";
import { computeBalanceTrend, computeDelta } from "../src/application/loyalty/balance-trend";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { asAccountId } from "./ids";
const max = Number.MAX_SAFE_INTEGER;
const base = findSweetSpot("hyatt-cat1-4-standard")!;
const holding: Holding = { providerId: "hyatt", points: 50_000, centsPerPoint: 1, daysUntilExpiry: null };
const run = (holdings: Holding[], spot = base, quantity = 1) => optimizeRedemptions({ holdings, sweetSpots: [spot], goal: { kind: "hotel", targetProgramId: "hyatt", quantity }, bonuses: [], now: new Date("2026-10-02") });
describe("optimizer and trend numeric boundaries", () => {
  it.each([max + 1, NaN, Infinity, -1, 0.5])("rejects unsafe holdings instead of filtering them away: %s", points => {
    expect(() => run([{ ...holding, points }])).toThrow();
  });
  it("can plan small redemptions from exact aggregate capacity above the safe integer boundary", () => {
    const result = run([{ ...holding, points: max }, { ...holding, providerId: "chase-ultimate-rewards", points: max, centsPerPoint: 1.1 }]);
    expect(result.plans[0]).toMatchObject({ status: "fundable", destinationPointsNeeded: base.pointsCost, destinationPointsProvided: base.pointsCost, totalSourcePoints: base.pointsCost });
  });
  it("rejects unrepresentable unit-point products and estimated value DTOs", () => {
    expect(() => run([holding], { ...base, pointsCost: max }, 2)).toThrow();
    expect(() => run([{ ...holding, points: max }], { ...base, pointsCost: max, estimatedCentsPerPoint: 2 })).toThrow();
  });
  it("ranks a representable large plan without overflowing internal milli-cent costs", () => {
    const result = run([{ ...holding, points: max, centsPerPoint: 0.5 }], { ...base, pointsCost: max, estimatedCentsPerPoint: 0.5 });
    expect(result.plans[0]).toMatchObject({ totalSourcePoints: max, valueCents: 4503599627370496, opportunityCostCents: 4503599627370496 });
  });
  it("keeps the existing zero valuation policy", () => {
    expect(run([{ ...holding, centsPerPoint: 0 }], { ...base, estimatedCentsPerPoint: 0 }).plans[0]).toMatchObject({ valueCents: 0, opportunityCostCents: 0, effectiveCentsPerPoint: 0 });
  });
  it("rejects nonfinite monetary outputs", () => {
    expect(() => run([{ ...holding, centsPerPoint: Infinity }])).toThrow();
    expect(() => run([{ ...holding, centsPerPoint: max }])).toThrow();
  });
  it("computes exact signed safe-boundary deltas", () => {
    expect(computeDelta(max, 0)).toEqual({ points: max, percent: null });
    expect(computeDelta(0, max)).toEqual({ points: -max, percent: -1 });
    expect(() => computeDelta(max + 1, 1)).toThrow();
    const latest = { ...createBalanceSnapshot({ loyaltyAccountId: asAccountId("fixture"), points: 1, source: "manual" }), points: max + 1 };
    expect(() => computeBalanceTrend({ latest, previous: null, asOf30Days: null, asOf90Days: null })).toThrow();
  });
});
