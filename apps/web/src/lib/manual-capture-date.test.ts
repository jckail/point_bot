import { describe, expect, it } from "vitest";
import { manualCaptureDate } from "./manual-capture-date";
const now = new Date("2026-10-02T06:00:00.000Z");
describe("UTC manual capture calendar validation", () => {
  it.each(["2026-02-29", "2024-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "26-10-02", "2026-1-02", "2026-10-2", "2026-10-02T00:00:00Z", " 2026-10-02", "2026-10-03"])("rejects invalid or future date %s", value => {
    expect(manualCaptureDate(value, now)).toBeNull();
  });
  it.each(["2024-02-29", "2000-02-29", "0099-01-01", "0001-01-01"])("preserves real calendar date %s including pre-100 years", value => {
    expect(manualCaptureDate(value, now)?.toISOString()).toBe(`${value}T12:00:00.000Z`);
  });
  it("rejects non-leap century dates and keeps blank as the core now default", () => {
    expect(manualCaptureDate("1900-02-29", now)).toBeNull();
    expect(manualCaptureDate("", now)).toBeUndefined();
  });
});
