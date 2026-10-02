import { describe, expect, it } from "vitest";

import { InvalidAwardWatchError, InvalidBalanceError, InvalidGoalTargetError, InvalidValuationError } from "../src/domain/errors";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { applyTripGoalChanges, computeGoalProgress, createTripGoal } from "../src/domain/loyalty/trip-goal";
import { normalizeCentsPerPoint } from "../src/domain/loyalty/custom-valuation";
import { createAwardWatch, normalizeObservedCentsPerPoint, recordCheck, shouldNotify } from "../src/domain/loyalty/award-watch";
import { LoyaltyAccountId } from "../src/domain/shared/ids";
import { asUserId } from "./ids";

const userId = asUserId("numeric-owner");
const accountId = LoyaltyAccountId.parse("numeric-account");
const watchInput = { userId, url: "https://example.com/award", label: "Award", minCentsPerPoint: 2 };

describe("safe point domain boundaries", () => {
  it.each([0, Number.MAX_SAFE_INTEGER])("accepts representable balance %s", points => {
    expect(createBalanceSnapshot({ loyaltyAccountId: accountId, points, source: "agent" }).points).toBe(points);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid balance %s", points => {
    expect(() => createBalanceSnapshot({ loyaltyAccountId: accountId, points, source: "sync" })).toThrow(InvalidBalanceError);
  });

  it("accepts a safe maximum goal on creation and update", () => {
    const goal = createTripGoal({ userId, title: "Trip", targetPoints: Number.MAX_SAFE_INTEGER });
    expect(goal.targetPoints).toBe(Number.MAX_SAFE_INTEGER);
    expect(applyTripGoalChanges(goal, { targetPoints: 1 }).targetPoints).toBe(1);
  });

  it("rejects a goal-progress sum beyond the exact range", () => {
    const second = LoyaltyAccountId.parse("second-numeric-account");
    const goal = createTripGoal({ userId, title: "Trip", targetPoints: 1, accountIds: [accountId, second] });
    expect(() => computeGoalProgress(goal, new Map([[accountId, Number.MAX_SAFE_INTEGER], [second, 1]]))).toThrow(InvalidBalanceError);
    expect(computeGoalProgress(goal, new Map([[accountId, Number.MAX_SAFE_INTEGER - 1], [second, 1]])).currentPoints).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid goal target %s on both paths", targetPoints => {
    expect(() => createTripGoal({ userId, title: "Trip", targetPoints })).toThrow(InvalidGoalTargetError);
    const goal = createTripGoal({ userId, title: "Trip", targetPoints: 1 });
    expect(() => applyTripGoalChanges(goal, { targetPoints })).toThrow(InvalidGoalTargetError);
  });
});

describe("field-specific milli-cents domain boundaries", () => {
  it.each([0.0001, 0, -1, 100.0001, Number.NaN, Number.POSITIVE_INFINITY])("rejects unrepresentable threshold/rate %s", value => {
    expect(() => normalizeCentsPerPoint(value)).toThrow(InvalidValuationError);
    expect(() => createAwardWatch({ ...watchInput, minCentsPerPoint: value })).toThrow(InvalidAwardWatchError);
  });

  it.each([[0.0005, 0.001], [1.2344, 1.234], [1.2345, 1.235], [100, 100]])("normalizes %s consistently to %s", (value, expected) => {
    expect(normalizeCentsPerPoint(value)).toBe(expected);
    expect(createAwardWatch({ ...watchInput, minCentsPerPoint: value }).minCentsPerPoint).toBe(expected);
  });

  it("retains null, zero and observed rates above the threshold cap", () => {
    expect(normalizeObservedCentsPerPoint(null)).toBeNull();
    expect(normalizeObservedCentsPerPoint(0)).toBe(0);
    expect(normalizeObservedCentsPerPoint(200.1234)).toBe(200.123);
    expect(normalizeObservedCentsPerPoint(2_147_483_647 / 1000)).toBe(2_147_483.647);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648 / 1000])("rejects invalid observed rate %s before decision or update", value => {
    const watch = createAwardWatch(watchInput);
    expect(() => shouldNotify(watch, value)).toThrow(InvalidAwardWatchError);
    expect(() => recordCheck(watch, { bestRealizedCpp: value, notified: true, now: new Date() })).toThrow(InvalidAwardWatchError);
    expect(watch.bestSeenCentsPerPoint).toBeNull();
  });

  it("compares the normalized observed value and stores that same value", () => {
    const watch = createAwardWatch({ ...watchInput, minCentsPerPoint: 2.0004 });
    expect(shouldNotify(watch, 1.9996)).toBe(true);
    const recorded = recordCheck(watch, { bestRealizedCpp: 1.9996, notified: true, now: new Date() });
    expect(recorded.bestSeenCentsPerPoint).toBe(2);
    expect(shouldNotify(recorded, 2.0004)).toBe(false);
  });
});
