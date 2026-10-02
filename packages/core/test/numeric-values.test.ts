import { describe, expect, it } from "vitest";
import { safeIntegerFromDatabase } from "../src/infrastructure/db/numeric-values";
import { InvalidBalanceError } from "../src/domain/errors";

const points = (value: unknown) => safeIntegerFromDatabase(value, 0, Number.MAX_SAFE_INTEGER, () => new InvalidBalanceError());
describe("exact persisted integer boundaries", () => {
  it.each([0, "0", 0n, Number.MAX_SAFE_INTEGER, "9007199254740991", 9007199254740991n])("accepts exact safe points %s", value => {
    expect(points(value)).toBe(typeof value === "number" ? value : Number(value));
  });
  it.each([-1, "-1", -1n, Number.MAX_SAFE_INTEGER + 1, "9007199254740992", "9223372036854775807", 9007199254740992n,
    1.5, "1.5", "1e3", "", " 1", null, undefined, NaN, Infinity])("rejects invalid values without clamping %s", value => {
    expect(() => points(value)).toThrow(InvalidBalanceError);
  });
  it("uses field-specific integer ranges", () => {
    expect(() => safeIntegerFromDatabase("0", 1, Number.MAX_SAFE_INTEGER, () => new Error("goal"))).toThrow("goal");
    expect(safeIntegerFromDatabase("2147483647", 0, 2147483647, () => new Error("rate"))).toBe(2147483647);
    expect(() => safeIntegerFromDatabase("2147483648", 0, 2147483647, () => new Error("rate"))).toThrow("rate");
  });
});
