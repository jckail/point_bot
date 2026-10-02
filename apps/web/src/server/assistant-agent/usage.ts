import type { Usage } from "@openai/agents";

// Export only known numeric fields. Provider-specific details can change and
// must never become arbitrary log keys or accidentally carry response data.
function detailTotal(details: Array<Record<string, number>>, key: string) {
  let total = 0;
  let found = false;
  for (const detail of details) {
    const value = detail[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
    if (!Number.isSafeInteger(total + value)) return undefined;
    total += value;
    found = true;
  }
  return found ? total : undefined;
}

export function observedUsage(usage: Usage) {
  const cachedInputTokens = detailTotal(usage.inputTokensDetails, "cached_tokens");
  const reasoningOutputTokens = detailTotal(usage.outputTokensDetails, "reasoning_tokens");
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    modelRequests: usage.requests,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
  };
}
