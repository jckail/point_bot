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
    recordAssistantMetrics(sink, { ...event, event: "run_started", durationMs: 999 });
    recordAssistantMetrics(sink, { ...event, event: "run_completed", status: "success", durationMs: 150 });
    recordAssistantMetrics(sink, { ...event, event: "tool_completed", status: "cancelled", durationMs: 4 });
    recordAssistantMetrics(sink, { ...event, event: "sdk_tool_finished", durationMs: 999 });
    recordAssistantMetrics(sink, { ...event, event: "agent_finished", status: "success", durationMs: 999 });
    expect(sink.counter).toHaveBeenCalledTimes(3);
    expect(sink.histogram.mock.calls.map(call => call[0])).toEqual(["assistant_run_duration_ms", "assistant_tool_duration_ms"]);
    expect(sink.counter).toHaveBeenLastCalledWith("assistant_tool_calls_total", { source: "extension", mode: "agents", outcome: "cancelled" }, 1);
  });
  it.each(["failed", "timeout", "cancelled", "max_turns"])("records one terminal duration for %s without private dimensions", status => {
    const sink = metrics();
    recordAssistantMetrics(sink, { ...event, event: "run_started", durationMs: 100 });
    recordAssistantMetrics(sink, { ...event, event: "run_failed", status, durationMs: 30_000, tool: "private-tool-value" });
    recordAssistantMetrics(sink, { ...event, event: "agent_finished", status, durationMs: 30_000 });
    expect(sink.histogram.mock.calls).toEqual([
      ["assistant_run_duration_ms", 30_000, { source: "extension", mode: "agents", outcome: status }],
    ]);
    expect(sink.counter).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sink.histogram.mock.calls)).not.toMatch(/private-request|private-trace|private-tool-value/);
  });

  it.each(["run_completed", "run_failed"])("omits invalid %s durations while recording valid zero and fractional durations", terminal => {
    const sink = metrics();
    for (const durationMs of [undefined, NaN, Infinity, -Infinity, -1]) {
      recordAssistantMetrics(sink, { ...event, event: terminal, status: "failed", durationMs });
    }
    expect(sink.histogram).not.toHaveBeenCalled();
    recordAssistantMetrics(sink, { ...event, event: terminal, status: "failed", durationMs: 0 });
    recordAssistantMetrics(sink, { ...event, event: terminal, status: "failed", durationMs: 1.5 });
    expect(sink.histogram.mock.calls.map(call => call[1])).toEqual([0, 1.5]);
    expect(sink.counter).toHaveBeenCalledTimes(7);
  });

  it("bounds unexpected failure outcome labels", () => {
    const sink = metrics();
    recordAssistantMetrics(sink, { ...event, event: "run_failed", status: "private-unbounded-value", durationMs: 10 });
    expect(sink.histogram).toHaveBeenCalledExactlyOnceWith("assistant_run_duration_ms", 10, { source: "extension", mode: "agents", outcome: "unknown" });
  });

  it("contains histogram failures and continues observing later terminal outcomes", () => {
    const sink = metrics();
    sink.histogram.mockImplementationOnce(() => { throw new Error("synthetic exporter failure"); });
    expect(() => recordAssistantMetrics(sink, { ...event, event: "run_failed", status: "timeout", durationMs: 30_000 })).not.toThrow();
    recordAssistantMetrics(sink, { ...event, event: "run_completed", status: "success", durationMs: 100 });
    expect(sink.counter).toHaveBeenCalledTimes(2);
    expect(sink.histogram).toHaveBeenCalledTimes(2);
    expect(sink.histogram).toHaveBeenLastCalledWith("assistant_run_duration_ms", 100, { source: "extension", mode: "agents", outcome: "success" });
  });

  it("contains a failed metric sink without losing later observations", () => {
    const sink = metrics();
    sink.counter.mockImplementationOnce(() => { throw new Error("exporter unavailable"); });
    expect(() => recordAssistantMetrics(sink, { ...event, inputTokens: 5, outputTokens: 2, modelRequests: 1 })).not.toThrow();
    expect(sink.counter).toHaveBeenCalledTimes(3);
  });
});
