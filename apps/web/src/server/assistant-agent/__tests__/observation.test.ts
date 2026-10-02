import { beforeEach, expect, it, vi } from "vitest";

const { log, counter } = vi.hoisted(() => ({ log: vi.fn(), counter: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
vi.mock("../../observability", () => ({ webObservability: () => ({ logger: { info: log }, metrics: { counter, histogram: vi.fn(), gauge: vi.fn() } }) }));
import { logObservation } from "../index";

it("maps known usage counts to log fields without replacing OTel trace IDs", () => {
  logObservation({ event: "run_usage", requestId: "support-reference", mode: "agents", surface: "web",
    sdkTraceId: `trace_${"a".repeat(32)}`, modelRequests: 2,
    inputTokens: 40, outputTokens: 10, totalTokens: 50, cachedInputTokens: 3, reasoningOutputTokens: 2 });
  expect(log).toHaveBeenCalledWith("assistant_event", {
    component: "pointup_assistant", event: "run_usage", requestId: "support-reference", mode: "agents", surface: "web",
    sdkTraceId: `trace_${"a".repeat(32)}`, modelRequests: 2,
    inputTokenCount: 40, outputTokenCount: 10, totalTokenCount: 50, cachedInputTokenCount: 3, reasoningOutputTokenCount: 2,
  });
  const fields = log.mock.calls[0]?.[1];
  expect(fields).not.toHaveProperty("traceId");
  expect(fields).not.toHaveProperty("inputTokens");
});

it("still records metrics when logging fails", () => {
  log.mockImplementation(() => { throw new Error("log sink unavailable"); });
  expect(() => logObservation({ event: "run_started", requestId: "support-reference", mode: "agents", surface: "api" })).not.toThrow();
  expect(counter).toHaveBeenCalledWith("assistant_run_events_total", { source: "api", mode: "agents", outcome: "started" }, 1);
});
