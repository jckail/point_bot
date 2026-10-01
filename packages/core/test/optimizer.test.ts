import { describe, expect, it } from "vitest";

import {
  optimizeRedemptions,
  type Holding,
  type OptimizerInput,
  type RedemptionGoal,
  type RedemptionPlan,
} from "../src/domain/loyalty/optimizer";
import { PROVIDER_CATALOG, findProvider, type ProviderId } from "../src/domain/loyalty/provider";
import {
  SWEET_SPOTS,
  findSweetSpot,
} from "../src/domain/loyalty/catalog/sweet-spots";
import {
  createTransferBonus,
  type TransferBonus,
} from "../src/domain/loyalty/transfer-bonus";
import {
  TRANSFER_EDGES,
  convertPoints,
  edgeRatio,
  findTransferEdge,
} from "../src/domain/loyalty/transfer-partners";

const now = new Date("2026-10-15T00:00:00Z");

function holding(
  providerId: ProviderId,
  points: number,
  extra: Partial<Holding> = {},
): Holding {
  const provider = findProvider(providerId)!;
  return {
    providerId,
    points,
    centsPerPoint: provider.estimatedCentsPerPoint,
    daysUntilExpiry: null,
    ...extra,
  };
}

function bonus(
  from: string,
  to: string,
  permille: number,
  extra: Partial<Parameters<typeof createTransferBonus>[0]> = {},
): TransferBonus {
  return createTransferBonus({
    id: `${from}>${to}`,
    fromProviderId: from,
    toProviderId: to,
    multiplierPermille: permille,
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-10-31T00:00:00Z"),
    source: "manual",
    now,
    ...extra,
  });
}

function run(
  holdings: Holding[],
  goal: Partial<RedemptionGoal> = {},
  bonuses: TransferBonus[] = [],
  maxPlans = 50,
) {
  const input: OptimizerInput = {
    holdings,
    goal: { kind: "any", ...goal },
    bonuses,
    now,
    maxPlans,
  };
  return optimizeRedemptions(input);
}

/** Every invariant that must hold for any plan, whatever the portfolio. */
function assertPlanInvariants(
  plan: RedemptionPlan,
  holdings: readonly Holding[],
  bonuses: readonly TransferBonus[],
) {
  const balances = new Map(holdings.map((h) => [h.providerId, h.points]));
  const seen = new Set<string>();
  let provided = 0;
  let total = 0;
  for (const source of plan.sources) {
    expect(seen.has(source.providerId)).toBe(false);
    seen.add(source.providerId);
    expect(Number.isInteger(source.pointsUsed)).toBe(true);
    expect(source.pointsUsed).toBeGreaterThan(0);
    expect(source.pointsUsed).toBeLessThanOrEqual(
      balances.get(source.providerId) ?? 0,
    );
    expect(Number.isInteger(source.destinationPoints)).toBe(true);
    if (source.direct) {
      expect(source.providerId).toBe(plan.programId);
      expect(source.destinationPoints).toBe(source.pointsUsed);
    } else {
      const edge = findTransferEdge(source.providerId, plan.programId)!;
      expect(edge).not.toBeNull();
      const permille = source.bonus?.multiplierPermille ?? 1000;
      // Bonus math is exactly convertPoints, never a parallel implementation.
      expect(source.destinationPoints).toBe(
        convertPoints(edge, source.pointsUsed, permille),
      );
      if (source.bonus) {
        const active = bonuses.find((b) => b.id === source.bonus!.id)!;
        expect(active.multiplierPermille).toBe(permille);
      }
    }
    provided += source.destinationPoints;
    total += source.pointsUsed;
  }
  expect(plan.destinationPointsProvided).toBe(provided);
  expect(plan.totalSourcePoints).toBe(total);
  expect(plan.surplusDestinationPoints).toBe(
    Math.max(0, provided - plan.destinationPointsNeeded),
  );
  if (plan.status === "fundable") {
    expect(provided).toBeGreaterThanOrEqual(plan.destinationPointsNeeded);
    expect(plan.shortfall).toBeNull();
    expect(plan.effectiveCentsPerPoint).toBeGreaterThan(0);
  } else {
    expect(provided).toBeLessThan(plan.destinationPointsNeeded);
    expect(plan.shortfall!.pointsNeeded).toBe(
      plan.destinationPointsNeeded - provided,
    );
    expect(plan.shortfall!.pointsNeeded).toBeGreaterThan(0);
  }
  for (const n of [
    plan.valueCents,
    plan.opportunityCostCents,
    plan.totalSourcePoints,
    plan.destinationPointsNeeded,
    plan.units,
  ]) {
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  expect(plan.caveats.length).toBeGreaterThanOrEqual(3);
  expect(plan.caveats.join(" ")).toMatch(/NOT verified|re-check/);
  expect(plan.caveats.join(" ")).toMatch(/irreversible/);
  expect(plan.steps.at(-1)!.kind === "book" || plan.steps.some((s) => s.kind === "book")).toBe(true);
}

// Deterministic PRNG so property tests are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCE_IDS = [
  ...new Set([
    ...TRANSFER_EDGES.map((e) => e.fromProviderId),
    ...SWEET_SPOTS.map((s) => s.programId),
  ]),
].filter((id) => findProvider(id));

function randomPortfolio(
  rand: () => number,
  size: number,
  pool: readonly ProviderId[] = SOURCE_IDS,
): Holding[] {
  const ids = [...pool];
  const out: Holding[] = [];
  for (let i = 0; i < size && ids.length > 0; i++) {
    const id = ids.splice(Math.floor(rand() * ids.length), 1)[0]!;
    const points = Math.floor(rand() ** 2 * 400_000);
    const expiring = rand() < 0.3;
    out.push(
      holding(id, points, {
        centsPerPoint: Math.round((0.3 + rand() * 2.5) * 100) / 100,
        daysUntilExpiry: expiring ? Math.floor(rand() * 120) - 10 : null,
      }),
    );
  }
  return out;
}

function randomBonuses(rand: () => number): TransferBonus[] {
  const edges = TRANSFER_EDGES.filter(() => rand() < 0.08);
  return edges.map((e) =>
    bonus(e.fromProviderId, e.toProviderId, 1000 + 50 * (1 + Math.floor(rand() * 40)), {
      source: rand() < 0.5 ? "user" : "manual",
      verifiedAt: rand() < 0.3 ? now : null,
    }),
  );
}

describe("edge ratios and convertPoints", () => {
  it("reduces decimal ratios to exact rationals", () => {
    const choice = findTransferEdge("citi-thankyou", "choice-privileges")!;
    expect(edgeRatio(choice)).toEqual({ num: 3, den: 2 });
    expect(convertPoints(choice, 1_001)).toBe(1_501);
    const rbc = findTransferEdge("rbc-avion", "american")!;
    expect(edgeRatio(rbc)).toEqual({ num: 7, den: 10 });
  });

  it("applies bonuses with integer flooring after the base conversion", () => {
    const amex = findTransferEdge("amex-membership-rewards", "cathay-asia-miles")!;
    // 5:4 base of 10,001 is 8,000 (floor), then +25% = 10,000.
    expect(convertPoints(amex, 10_001)).toBe(8_000);
    expect(convertPoints(amex, 10_001, 1250)).toBe(10_000);
  });
});

describe("sweet spot catalog integrity", () => {
  it("only references catalog programs and is honest about verification", () => {
    const ids = new Set<string>();
    expect(SWEET_SPOTS.length).toBeGreaterThanOrEqual(30);
    for (const spot of SWEET_SPOTS) {
      expect(ids.has(spot.id)).toBe(false);
      ids.add(spot.id);
      expect(PROVIDER_CATALOG.some((p) => p.id === spot.programId)).toBe(true);
      expect(spot.verified).toBe(false);
      expect(spot.confidence).not.toBe("high");
      expect(spot.lastReviewed).toBe("2026-10-01");
      expect(spot.pointsCostMin).toBeLessThanOrEqual(spot.pointsCost);
      expect(spot.pointsCost).toBeLessThanOrEqual(spot.pointsCostMax);
      expect(spot.estimatedCentsPerPoint).toBeGreaterThan(0);
      expect(spot.constraints.length).toBeGreaterThan(0);
      expect(spot.maxUnits).toBeGreaterThanOrEqual(1);
      if (spot.cppBasis === "derived") {
        expect(spot.cashValueCents).not.toBeNull();
        expect(spot.estimatedCentsPerPoint).toBeCloseTo(
          spot.cashValueCents! / spot.pointsCost,
          2,
        );
      }
    }
  });
});

describe("optimizeRedemptions: fixtures", () => {
  it("returns no plans (with a note) for an empty portfolio", () => {
    const result = run([]);
    expect(result.plans).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/No balances/);
  });

  it("funds a Hyatt stay from UR 1:1, rounded up to a 1,000 block", () => {
    const result = run(
      [holding("chase-ultimate-rewards", 100_000)],
      { kind: "hotel", targetProgramId: "hyatt", quantity: 3 },
    );
    const plan = result.plans.find((p) => p.spotId === "hyatt-cat1-4-standard")!;
    expect(plan.status).toBe("fundable");
    expect(plan.units).toBe(3);
    expect(plan.destinationPointsNeeded).toBe(24_000);
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0]).toMatchObject({
      providerId: "chase-ultimate-rewards",
      pointsUsed: 24_000,
      destinationPoints: 24_000,
      bonus: null,
    });
    expect(plan.steps.map((s) => s.kind)).toEqual(["transfer", "book"]);
    expect(plan.steps[0]!.text).toContain("Transfer 24,000");
    expect(plan.steps[0]!.text).toContain("1:1");
    expect(plan.steps[1]!.text).toContain("x3 nights");
  });

  it("a +30% bonus reduces the points spent and says so in the steps", () => {
    const b = bonus("chase-ultimate-rewards", "hyatt", 1300);
    const result = run(
      [holding("chase-ultimate-rewards", 100_000)],
      { kind: "hotel", targetProgramId: "hyatt", quantity: 3 },
      [b],
    );
    const plan = result.plans.find((p) => p.spotId === "hyatt-cat1-4-standard")!;
    // 18,000 -> 23,400 (< 24,000); 19,000 -> 24,700 (>= 24,000).
    expect(plan.sources[0]!.pointsUsed).toBe(19_000);
    expect(plan.sources[0]!.destinationPoints).toBe(24_700);
    expect(plan.surplusDestinationPoints).toBe(700);
    expect(plan.steps[0]!.text).toContain("+30% bonus until 2026-10-31");
    expect(plan.steps[0]!.text).toContain("unverified");
    expect(plan.caveats.join(" ")).toMatch(/bonus is not yet verified/);
    // An unverified bonus caps confidence at medium.
    expect(plan.confidence).toBe("medium");
  });

  it("flags user-reported bonuses distinctly and drops expired ones", () => {
    const userBonus = bonus("chase-ultimate-rewards", "hyatt", 1500, { source: "user" });
    const expired = bonus("chase-ultimate-rewards", "hyatt", 2000, {
      startsAt: new Date("2026-08-01T00:00:00Z"),
      endsAt: new Date("2026-08-31T00:00:00Z"),
    });
    const result = run(
      [holding("chase-ultimate-rewards", 100_000)],
      { kind: "hotel", targetProgramId: "hyatt", quantity: 2 },
      [userBonus, expired],
    );
    const plan = result.plans.find((p) => p.spotId === "hyatt-cat1-4-standard")!;
    expect(plan.sources[0]!.bonus!.multiplierPermille).toBe(1500);
    expect(plan.caveats.join(" ")).toMatch(/user-reported/);
  });

  it("uses the cheaper source first and splits across currencies when needed", () => {
    // Flying Blue is reachable 1:1 from UR, MR and Capital One; MR is cheapest.
    const holdings = [
      holding("chase-ultimate-rewards", 40_000, { centsPerPoint: 2 }),
      holding("amex-membership-rewards", 20_000, { centsPerPoint: 1 }),
      holding("capital-one-miles", 40_000, { centsPerPoint: 1.5 }),
    ];
    const result = run(holdings, { kind: "flight", targetProgramId: "flying-blue", quantity: 1 });
    const plan = result.plans.find((p) => p.spotId === "flying-blue-promo-rewards")!;
    expect(plan.status).toBe("fundable");
    expect(plan.destinationPointsNeeded).toBe(30_000);
    const used = Object.fromEntries(plan.sources.map((s) => [s.providerId, s.pointsUsed]));
    expect(used["amex-membership-rewards"]).toBe(20_000);
    expect(used["capital-one-miles"]).toBe(10_000);
    expect(used["chase-ultimate-rewards"]).toBeUndefined();
    assertPlanInvariants(plan, holdings, []);
  });

  it("spends direct balance before transferring when it is the cheaper point", () => {
    const holdings = [
      holding("hyatt", 5_000, { centsPerPoint: 0.5 }),
      holding("chase-ultimate-rewards", 50_000, { centsPerPoint: 2 }),
    ];
    const plan = run(holdings, { kind: "hotel", targetProgramId: "hyatt", quantity: 2 }).plans.find(
      (p) => p.spotId === "hyatt-cat1-4-standard",
    )!;
    expect(plan.sources[0]).toMatchObject({ providerId: "hyatt", direct: true, pointsUsed: 5_000 });
    expect(plan.sources[1]).toMatchObject({ providerId: "chase-ultimate-rewards", pointsUsed: 11_000 });
    expect(plan.steps[0]!.kind).toBe("use");
  });

  it("prefers expiring points when otherwise equal and flags urgency", () => {
    const holdings = [
      holding("chase-ultimate-rewards", 30_000, { centsPerPoint: 1.5 }),
      holding("amex-membership-rewards", 30_000, { centsPerPoint: 1.5, daysUntilExpiry: 20 }),
    ];
    const result = run(holdings, { kind: "flight", targetProgramId: "flying-blue", quantity: 1 });
    const plan = result.plans.find((p) => p.spotId === "flying-blue-promo-rewards")!;
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0]!.providerId).toBe("amex-membership-rewards");
    expect(plan.expiryUrgency).toBe("urgent");
    expect(plan.caveats.join(" ")).toMatch(/expire soon/);
    expect(result.expiringHoldings).toEqual([
      { providerId: "amex-membership-rewards", points: 30_000, daysUntilExpiry: 20, usedByPlan: true },
    ]);
  });

  it("ranks the plan that burns expiring points above an otherwise equal one", () => {
    const base = [holding("hyatt", 40_000, { centsPerPoint: 1.7 })];
    const calm = run(base, { kind: "hotel" }).plans[0]!;
    const expiring = run(
      [holding("hyatt", 40_000, { centsPerPoint: 1.7, daysUntilExpiry: 10 })],
      { kind: "hotel" },
    ).plans[0]!;
    expect(expiring.rankScoreCents).toBeGreaterThan(calm.rankScoreCents);
    expect(expiring.netGainCents).toBe(calm.netGainCents); // real value is unchanged
  });

  it("reports a shortfall with who could cover it via transfer", () => {
    const holdings = [
      holding("chase-ultimate-rewards", 5_000),
      holding("amex-membership-rewards", 2_000),
    ];
    const result = run(holdings, { kind: "flight", targetProgramId: "flying-blue", quantity: 1 });
    const plan = result.plans.find((p) => p.spotId === "flying-blue-promo-rewards")!;
    expect(plan.status).toBe("shortfall");
    expect(plan.shortfall!.pointsNeeded).toBe(30_000 - 7_000);
    expect(plan.shortfall!.programId).toBe("flying-blue");
    const providers = plan.shortfall!.coverage.map((c) => c.providerId);
    expect(providers).toContain("capital-one-miles");
    for (const hint of plan.shortfall!.coverage) {
      expect(hint.sourcePointsNeeded).toBeGreaterThan(0);
      expect(hint.sourcePointsNeeded % 1000).toBe(0);
    }
    expect(plan.caveats.join(" ")).toMatch(/not fully funded/);
    // Shortfall plans never claim a net gain.
    expect(plan.netGainCents).toBe(0);
    assertPlanInvariants(plan, holdings, []);
  });

  it("respects an edge's minimum and increment (RBC Avion -> American)", () => {
    const rbc = holding("rbc-avion", 20_000);
    const plan = run([rbc], { kind: "flight", targetProgramId: "american", quantity: 1 }).plans.find(
      (p) => p.spotId === "american-web-special",
    )!;
    expect(plan.status).toBe("fundable");
    // 10:7 -> need 12,500: smallest multiple of 10 with floor(x*0.7) >= 12,500.
    expect(plan.sources[0]!.pointsUsed).toBe(17_860);
    expect(plan.sources[0]!.destinationPoints).toBe(12_502);
    const below = run([holding("rbc-avion", 3_000)], { kind: "flight", targetProgramId: "american" });
    expect(below.plans.every((p) => p.sources.length === 0 || p.sources[0]!.providerId !== "rbc-avion")).toBe(true);
  });

  it("filters by goal kind, target program and minimum value", () => {
    const holdings = [holding("chase-ultimate-rewards", 200_000)];
    const flights = run(holdings, { kind: "flight" }).plans;
    expect(flights.length).toBeGreaterThan(0);
    expect(flights.every((p) => p.kind === "flight")).toBe(true);
    const hotels = run(holdings, { kind: "hotel" }).plans;
    expect(hotels.every((p) => p.kind === "hotel")).toBe(true);
    const target = run(holdings, { kind: "any", targetProgramId: "united" }).plans;
    expect(target.every((p) => p.programId === "united")).toBe(true);
    const picky = run(holdings, { kind: "any", minValueCpp: 2.5 }).plans;
    expect(picky.length).toBeGreaterThan(0);
    expect(picky.every((p) => p.effectiveCentsPerPoint >= 2.5)).toBe(true);
  });

  it("rejects invalid goals", () => {
    expect(() => run([], { targetProgramId: "nope" })).toThrow(/Unknown target/);
    expect(() => run([], { quantity: 0 })).toThrow(/quantity/);
    expect(() => run([], { minValueCpp: -1 })).toThrow(/minValueCpp/);
    expect(() => run([], { kind: "boat" as never })).toThrow(/goal kind/);
  });

  it("ranks fundable plans by net gain and puts shortfalls last", () => {
    const holdings = [
      holding("chase-ultimate-rewards", 120_000),
      holding("amex-membership-rewards", 15_000),
    ];
    const plans = run(holdings, { kind: "any" }).plans;
    const firstShortfall = plans.findIndex((p) => p.status === "shortfall");
    const lastFundable = plans.map((p) => p.status).lastIndexOf("fundable");
    if (firstShortfall >= 0) expect(lastFundable).toBeLessThan(firstShortfall);
    const fundable = plans.filter((p) => p.status === "fundable");
    for (let i = 1; i < fundable.length; i++) {
      expect(fundable[i - 1]!.rankScoreCents).toBeGreaterThanOrEqual(fundable[i]!.rankScoreCents);
    }
  });

  it("never mutates its input and is deterministic", () => {
    const holdings = [
      holding("chase-ultimate-rewards", 90_000),
      holding("amex-membership-rewards", 45_000, { daysUntilExpiry: 40 }),
    ];
    const frozen = JSON.stringify(holdings);
    const a = run(holdings);
    const b = run([...holdings].reverse());
    expect(JSON.stringify(holdings)).toBe(frozen);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is honest on every plan: unverified catalog, no availability claims", () => {
    const result = run([holding("chase-ultimate-rewards", 150_000)]);
    expect(result.plans.length).toBeGreaterThan(0);
    for (const plan of result.plans) {
      expect(plan.availability).toBeNull();
      expect(plan.confidence).not.toBe("high");
      expect(findSweetSpot(plan.spotId)!.verified).toBe(false);
    }
  });
});

describe("optimizeRedemptions: properties over random portfolios", () => {
  it("holds all invariants for 150 seeded portfolios", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = mulberry32(seed);
      const holdings = randomPortfolio(rand, 3 + Math.floor(rand() * 20));
      const bonuses = randomBonuses(rand);
      const kinds = ["any", "flight", "hotel"] as const;
      const goal: Partial<RedemptionGoal> = {
        kind: kinds[seed % 3]!,
        ...(seed % 5 === 0 ? { quantity: 1 + (seed % 4) } : {}),
      };
      const result = run(holdings, goal, bonuses);
      const again = run(holdings, goal, bonuses);
      expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      for (const plan of result.plans) {
        assertPlanInvariants(plan, holdings, bonuses);
      }
      // Total source points per currency across a single plan never exceed it.
      for (const plan of result.plans) {
        for (const s of plan.sources) {
          const h = holdings.find((x) => x.providerId === s.providerId)!;
          expect(s.pointsUsed).toBeLessThanOrEqual(h.points);
        }
      }
    }
  });

  it("a bigger bonus never needs more source points for the same goal", () => {
    for (let seed = 500; seed < 540; seed++) {
      const rand = mulberry32(seed);
      const holdings = [
        holding("chase-ultimate-rewards", 50_000 + Math.floor(rand() * 200_000)),
      ];
      const goal = { kind: "hotel" as const, targetProgramId: "hyatt", quantity: 1 + (seed % 5) };
      const none = run(holdings, goal).plans.find((p) => p.spotId === "hyatt-cat1-4-standard");
      const some = run(holdings, goal, [bonus("chase-ultimate-rewards", "hyatt", 1250)]).plans.find(
        (p) => p.spotId === "hyatt-cat1-4-standard",
      );
      const more = run(holdings, goal, [bonus("chase-ultimate-rewards", "hyatt", 1750)]).plans.find(
        (p) => p.spotId === "hyatt-cat1-4-standard",
      );
      if (none?.status === "fundable" && some && more) {
        expect(some.totalSourcePoints).toBeLessThanOrEqual(none.totalSourcePoints);
        expect(more.totalSourcePoints).toBeLessThanOrEqual(some.totalSourcePoints);
      }
    }
  });
});

describe("optimizeRedemptions: performance guard", () => {
  it("optimizes a 60-account portfolio in well under 50ms", () => {
    const rand = mulberry32(42);
    // The relevant currencies first (so the search has real work), then filler.
    const pool = [...SOURCE_IDS, ...PROVIDER_CATALOG.map((p) => p.id)].filter(
      (id, i, all) => all.indexOf(id) === i,
    );
    const holdings = randomPortfolio(rand, 60, pool).map((h) =>
      h.points < 5_000 ? { ...h, points: 25_000 + Math.floor(rand() * 100_000) } : h,
    );
    expect(holdings.length).toBe(60);
    const bonuses = randomBonuses(rand);
    // Warm up JIT, then measure the median of several runs.
    for (let i = 0; i < 3; i++) run(holdings, { kind: "any" }, bonuses);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      run(holdings, { kind: "any" }, bonuses);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[4]!).toBeLessThan(50);
  });
});
