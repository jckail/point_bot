import { describe, expect, it, vi } from "vitest";
import { recordAssistantMetrics } from "../metrics";

const event = { event: "run_usage", requestId: "private-request", sdkTraceId: "private-trace", mode: "agents" as const, surface: "extension" as const };
function metrics() { return { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() }; }

describe("assistant operational metrics", () => {
  it("keeps labels bounded and omits unreported or invalid usage", () => {
    const sink = metrics();
    recordAssistantMetrics(sink, { ...event, status: "arbitrary-user-value", tool: "private-tool-value", inputTokens: 5, outputTokens: NaN, totalTokens: -1, modelRequests: 2 });
    expect(sink.counter.mock.calls).toEqual([
      ["assistant_model_requests_total", { source: "extension", mode: "agents", outcome: "unknown" }, 2],
      ["assistant_input_tokens_total", { source: "extension", mode: "agents", outcome: "unknown" }, 5],
    ]);
  });
  it("records completion and tool durations without SDK lifecycle double counting", () => {
    const sink = metrics();
    recordAssistantMetrics(sink, { ...event, event: "run_started" });
    recordAssistantMetrics(sink, { ...event, event: "run_completed", status: "success", durationMs: 150 });
    recordAssistantMetrics(sink, { ...event, event: "tool_completed", status: "cancelled", durationMs: 4 });
    recordAssistantMetrics(sink, { ...event, event: "sdk_tool_finished" });
    expect(sink.counter).toHaveBeenCalledTimes(3);
    expect(sink.histogram.mock.calls.map(call => call[0])).toEqual(["assistant_run_duration_ms", "assistant_tool_duration_ms"]);
    expect(sink.counter).toHaveBeenLastCalledWith("assistant_tool_calls_total", { source: "extension", mode: "agents", outcome: "cancelled" }, 1);
  });
  it("contains a failed metric sink without losing later observations", () => {
    const sink = metrics();
    sink.counter.mockImplementationOnce(() => { throw new Error("exporter unavailable"); });
    expect(() => recordAssistantMetrics(sink, { ...event, inputTokens: 5, outputTokens: 2, modelRequests: 1 })).not.toThrow();
    expect(sink.counter).toHaveBeenCalledTimes(3);
  });
});
