import { describe, expect, it } from "vitest";

import { checkMetricsAccess, constantTimeEqual } from "./metrics-access";

describe("checkMetricsAccess", () => {
  const ok = { enabled: "true", token: "s3cret-token", authorization: "Bearer s3cret-token" };
  it("is off by default and without a configured token", () => {
    expect(checkMetricsAccess({ ...ok, enabled: undefined })).toBe("disabled");
    expect(checkMetricsAccess({ ...ok, enabled: "false" })).toBe("disabled");
    expect(checkMetricsAccess({ ...ok, token: undefined })).toBe("disabled");
    expect(checkMetricsAccess({ ...ok, token: "" })).toBe("disabled");
  });
  it("requires the exact bearer token", () => {
    expect(checkMetricsAccess(ok)).toBe("ok");
    expect(checkMetricsAccess({ ...ok, enabled: "TRUE" })).toBe("ok");
    expect(checkMetricsAccess({ ...ok, authorization: null })).toBe("unauthorized");
    expect(checkMetricsAccess({ ...ok, authorization: "Bearer wrong" })).toBe("unauthorized");
    expect(checkMetricsAccess({ ...ok, authorization: "Bearer s3cret-token-x" })).toBe("unauthorized");
    expect(checkMetricsAccess({ ...ok, authorization: "s3cret-token" })).toBe("unauthorized");
  });
  it("compares in constant time without throwing on length mismatch", () => {
    expect(constantTimeEqual("a", "a")).toBe(true);
    expect(constantTimeEqual("a", "ab")).toBe(false);
  });
});
