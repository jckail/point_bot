import { Usage } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { observedUsage } from "../usage";

describe("assistant usage observation", () => {
  it("aggregates SDK request details without copying unknown provider fields", () => {
    const usage = new Usage({ requests: 2, inputTokens: 50, outputTokens: 20, totalTokens: 70,
      inputTokensDetails: [{ cached_tokens: 12, arbitrary_detail: 123 }, { cached_tokens: 5 }],
      outputTokensDetails: [{ reasoning_tokens: 3 }, { reasoning_tokens: 4 }],
    });
    expect(observedUsage(usage)).toEqual({ inputTokens: 50, outputTokens: 20, totalTokens: 70,
      modelRequests: 2, cachedInputTokens: 17, reasoningOutputTokens: 7 });
  });

  it("distinguishes unavailable token details from a measured zero", () => {
    expect(observedUsage(new Usage())).not.toHaveProperty("cachedInputTokens");
    expect(observedUsage(new Usage({ inputTokensDetails: [{ cached_tokens: 0 }] })))
      .toHaveProperty("cachedInputTokens", 0);
  });

  it("ignores invalid counts and omits totals that would overflow", () => {
    const usage = new Usage({ inputTokensDetails: [{ cached_tokens: -1 }, { cached_tokens: Number.NaN },
      { cached_tokens: Number.MAX_SAFE_INTEGER }, { cached_tokens: 1 }],
      outputTokensDetails: [{ reasoning_tokens: 1.5 }, { reasoning_tokens: 2 }],
    });
    expect(observedUsage(usage)).not.toHaveProperty("cachedInputTokens");
    expect(observedUsage(usage)).toHaveProperty("reasoningOutputTokens", 2);
  });
});
