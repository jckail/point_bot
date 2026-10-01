import { describe, expect, it } from "vitest";

import { apiErrorSchema } from "../src/contracts";

describe("ApiError contract with correlation id", () => {
  it("accepts the legacy shape and the additive requestId", () => {
    expect(apiErrorSchema.parse({ error: { code: "X", message: "m" } })).toEqual({
      error: { code: "X", message: "m" },
    });
    expect(
      apiErrorSchema.parse({ error: { code: "X", message: "m", requestId: "req-12345678" } })
        .error.requestId,
    ).toBe("req-12345678");
    expect(() => apiErrorSchema.parse({ error: { code: "X", message: "m", requestId: 5 } })).toThrow();
  });
});
