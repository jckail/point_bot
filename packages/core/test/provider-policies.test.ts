import { describe, expect, it } from "vitest";
import { getProviderOrThrow, projectExpiryDate } from "../src/domain/loyalty/provider";

describe("published loyalty expiry policies", () => {
  it("does not project inactivity expiration for United MileagePlus", () => {
    expect(projectExpiryDate(getProviderOrThrow("united"), new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });
  it.each(["amtrak", "hilton"])("projects a 24-month qualifying activity window for %s", id => {
    expect(projectExpiryDate(getProviderOrThrow(id), new Date("2026-01-01T00:00:00Z"))?.toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });
  it("clamps leap-day anniversaries and preserves the observation time", () => {
    const policy = { ...getProviderOrThrow("amtrak"), inactivityExpiryMonths: 12 };
    expect(projectExpiryDate(policy, new Date("2024-02-29T12:34:56Z"))?.toISOString()).toBe("2025-02-28T12:34:56.000Z");
  });
});
