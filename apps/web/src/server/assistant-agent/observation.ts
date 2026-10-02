export type Observation = {
  event: string;
  surface?: "web" | "extension" | "api";
  requestId: string;
  mode: "agents" | "fallback";
  sdkTraceId?: string;
  durationMs?: number;
  tool?: string;
  status?: string;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelRequests?: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
};
export type Observer = (event: Observation) => void;
