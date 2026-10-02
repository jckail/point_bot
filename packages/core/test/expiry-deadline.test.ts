import { describe, expect, it } from "vitest";
import { toLoyaltyAccountReadModel } from "../src/application/loyalty/mappers";
import { deriveAlerts } from "../src/application/loyalty/derive-alerts";
import { computePortfolioSummary } from "../src/application/loyalty/get-portfolio-summary";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { asUserId } from "./ids";
const now = new Date("2026-10-02T12:00:00Z"), userId = asUserId("expiry-fixture");
describe("account expiry deadline", () => {
  it.each([[-86400001, -2], [-86400000, -1], [-3600000, -1], [-1, -1], [0, -1], [1, 1], [86400000, 1], [86400001, 2]])("maps %sms remaining to %s days and correct alert semantics", (remaining, days) => {
    const account = createLoyaltyAccount({ userId, providerId: "hyatt", membershipNumber: "synthetic", expiresAt: new Date(now.getTime() + remaining), now });
    const row = toLoyaltyAccountReadModel(account, null, now);
    expect(row.daysUntilExpiry).toBe(days); expect(Object.is(row.daysUntilExpiry, -0)).toBe(false);
    const alerts = deriveAlerts({ userId, summary: computePortfolioSummary([row]), accounts: [row], goals: [], expiring: [row] });
    expect(alerts[0]?.type).toBe(remaining <= 0 ? "expired" : "expiring");
    if (remaining <= 0) expect(alerts[0]?.message).not.toContain("reset the clock");
  });
  it("keeps unknown expiry null with no expiry alert", () => {
    const row = toLoyaltyAccountReadModel(createLoyaltyAccount({ userId, providerId: "hyatt", membershipNumber: "synthetic", expiresAt: null, now }), null, now);
    expect(row.daysUntilExpiry).toBeNull();
    expect(deriveAlerts({ userId, summary: computePortfolioSummary([row]), accounts: [row], goals: [], expiring: [] })).toEqual([]);
  });
});
