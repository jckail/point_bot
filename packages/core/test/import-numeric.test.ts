import { describe, expect, it } from "vitest";
import { parseImportedPoints } from "../src/application/loyalty/import-portfolio";

describe("CSV point claims before number conversion", () => {
  it("accepts exact nonnegative decimal integers and integral scientific notation", () => {
    for (const [text, value] of [["0", 0], [" 00100 ", 100], ["+100.0", 100], ["1.25e3", 1250], ["9007199254740991", Number.MAX_SAFE_INTEGER]] as const) {
      expect(parseImportedPoints(text)).toBe(value);
    }
  });
  it("rejects fractional values rounded to an integer by Number", () => {
    expect(Number.isSafeInteger(Number("9007199254740990.9"))).toBe(true);
    expect(parseImportedPoints("9007199254740990.9")).toBeNull();
    expect(parseImportedPoints("1.00000000000000001")).toBeNull();
  });
  it("rejects overflow, nondecimal and invalid claims without clamping", () => {
    for (const value of ["9007199254740992", "1e400", "-1", "NaN", "Infinity", "0x10", "", "0.1", "1e-1", "1e99999999999999999999999"]) {
      expect(parseImportedPoints(value)).toBeNull();
    }
  });
});
