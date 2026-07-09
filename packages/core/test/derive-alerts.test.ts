import { describe, expect, it } from "vitest";

import { deriveAlerts } from "../src/application/loyalty/derive-alerts";
import type { PortfolioDigestReadModel } from "../src/application/loyalty/build-portfolio-digest";
import type { LoyaltyAccountReadModel } from "../src/application/loyalty/read-models";
import type { TripGoalReadModel } from "../src/application/loyalty/create-trip-goal";
import type { BalanceTrend } from "../src/application/loyalty/balance-trend";

function account(
  over: {
    id: string;
    daysUntilExpiry?: number | null;
    sincePrevious?: BalanceTrend["sincePrevious"];
  },
): LoyaltyAccountReadModel {
  return {
    id: over.id,
    provider: {
      id: over.id,
      kind: "airline",
      displayName: over.id.toUpperCase(),
      pointsCurrency: "miles",
      estimatedCentsPerPoint: 1.3,
      inactivityExpiryMonths: 18,
    },
    membershipNumber: "X",
    hasStoredCredential: false,
    latestBalance: { points: 10_000, source: "manual", capturedAt: new Date("2026-01-01") },
    estimatedValueCents: 13_000,
    customCentsPerPoint: null,
    trend: {
      sincePrevious: over.sincePrevious ?? null,
      since30Days: null,
      since90Days: null,
    },
    expiresAt: null,
    daysUntilExpiry: over.daysUntilExpiry ?? null,
    notes: null,
    tags: [],
    pinnedAt: null,
    createdAt: new Date("2026-01-01"),
  };
}

function goal(over: Partial<TripGoalReadModel> & { id: string; achieved: boolean }): TripGoalReadModel {
  return {
    id: over.id,
    title: over.title ?? "Kyoto",
    targetPoints: 100_000,
    targetDate: null,
    accountIds: [],
    status: "active",
    notes: null,
    currentPoints: over.achieved ? 100_000 : 40_000,
    remainingPoints: over.achieved ? 0 : 60_000,
    percentComplete: over.achieved ? 100 : 40,
    achieved: over.achieved,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function digest(
  accounts: LoyaltyAccountReadModel[],
  goals: TripGoalReadModel[] = [],
): PortfolioDigestReadModel {
  return {
    userId: "u",
    summary: {
      totalPoints: 0,
      totalValueCents: 0,
      accountCount: accounts.length,
      byKind: {} as PortfolioDigestReadModel["summary"]["byKind"],
      lastSyncedAt: null,
    },
    accounts,
    goals,
    expiring: [],
  };
}

describe("deriveAlerts", () => {
  it("flags expiring and expired accounts", () => {
    const alerts = deriveAlerts(
      digest([
        account({ id: "delta", daysUntilExpiry: 10 }),
        account({ id: "aa", daysUntilExpiry: -3 }),
        account({ id: "united", daysUntilExpiry: 400 }), // outside window
        account({ id: "amex", daysUntilExpiry: null }), // never expires
      ]),
    );
    const types = alerts.map((a) => a.type);
    expect(types).toContain("expiring");
    expect(types).toContain("expired");
    expect(alerts.some((a) => a.providerId === "united")).toBe(false);
    expect(alerts.some((a) => a.providerId === "amex")).toBe(false);
  });

  it("flags big balance drops (warning) and jumps (info) past the thresholds", () => {
    const alerts = deriveAlerts(
      digest([
        account({ id: "drop", sincePrevious: { points: -5000, percent: -0.4 } }),
        account({ id: "jump", sincePrevious: { points: 8000, percent: 0.5 } }),
        account({ id: "tiny", sincePrevious: { points: -50, percent: -0.9 } }), // below min points
        account({ id: "small", sincePrevious: { points: 5000, percent: 0.05 } }), // below min percent
      ]),
    );
    const byProvider = new Map(alerts.map((a) => [a.providerId, a]));
    expect(byProvider.get("drop")?.type).toBe("balance-drop");
    expect(byProvider.get("drop")?.severity).toBe("warning");
    expect(byProvider.get("jump")?.type).toBe("balance-jump");
    expect(byProvider.get("jump")?.severity).toBe("info");
    expect(byProvider.has("tiny")).toBe(false);
    expect(byProvider.has("small")).toBe(false);
  });

  it("flags reached goals and orders warnings before info", () => {
    const alerts = deriveAlerts(
      digest(
        [
          // info-severity balance jump
          account({ id: "jump", sincePrevious: { points: 8000, percent: 0.5 } }),
          // warning-severity expiry
          account({ id: "delta", daysUntilExpiry: 10 }),
        ],
        [goal({ id: "g1", achieved: true }), goal({ id: "g2", achieved: false })],
      ),
    );
    expect(alerts.some((a) => a.type === "goal-reached" && a.goalId === "g1")).toBe(true);
    expect(alerts.some((a) => a.goalId === "g2")).toBe(false);
    // All warnings come before any info alert.
    const firstInfo = alerts.findIndex((a) => a.severity === "info");
    const lastWarning = alerts.map((a) => a.severity).lastIndexOf("warning");
    expect(lastWarning).toBeLessThan(firstInfo);
  });

  it("returns nothing for a calm portfolio", () => {
    expect(deriveAlerts(digest([account({ id: "united", daysUntilExpiry: 400 })]))).toEqual([]);
  });

  it("respects custom thresholds", () => {
    const d = digest([account({ id: "x", daysUntilExpiry: 30 })]);
    expect(deriveAlerts(d, { expiryWarningDays: 14 })).toEqual([]);
    expect(deriveAlerts(d, { expiryWarningDays: 60 })).toHaveLength(1);
  });
});
