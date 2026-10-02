import { describe, expect, it } from "vitest";
import { redact, REDACTED } from "../src/observability/redact";

const keys = ["inputTokenCount", "outputTokenCount", "totalTokenCount", "cachedInputTokenCount", "reasoningOutputTokenCount"];

describe("numeric assistant usage redaction", () => {
  it("allows only the five exact names, case-insensitively, at nested depths", () => {
    const counts = Object.fromEntries(keys.flatMap(key => [[key, 0], [key.toUpperCase(), Number.MAX_SAFE_INTEGER]]));
    expect(redact({ nested: [{ counts }] })).toEqual({ nested: [{ counts }] });
  });

  it("redacts invalid values instead of traversing secret-bearing count objects", () => {
    const invalid: unknown[] = [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "12", "PRIVATE_SECRET", null, undefined, true, 12n, { value: 12, message: "PRIVATE_BODY" }, [12, "PRIVATE_BODY"]];
    for (const key of keys) {
      for (const value of invalid) expect(redact({ [key]: value })).toEqual({ [key]: REDACTED });
    }
  });

  it("keeps wildcard secret filters and fixed exception metadata intact", () => {
    const input = {
      inputTokens: 10, outputTokens: 5, tokenCount: 15, inputTokenCountExtra: 10,
      prefixInputTokenCount: 10, "inputTokenCount.secret": 10, accessToken: "PRIVATE_TOKEN",
      authorization: "Bearer PRIVATE_SECRET", tokenId: "tok_1",
      inputTokenCount: 10, error: new Error("PRIVATE_PROVIDER_BODY"),
    };
    const output = redact(input);
    expect(output).toEqual({
      inputTokens: REDACTED, outputTokens: REDACTED, tokenCount: REDACTED, inputTokenCountExtra: REDACTED,
      prefixInputTokenCount: REDACTED, "inputTokenCount.secret": REDACTED, accessToken: REDACTED,
      authorization: REDACTED, tokenId: "tok_1", inputTokenCount: 10,
      error: { name: "OperationError", message: "Operation failed", category: "operation_failed" },
    });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_");
  });
});
