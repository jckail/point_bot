import { UserId } from "@pointup/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as sdk from "@openai/agents";
import { OpenAIResponsesModel, Span, type TracingProcessor } from "@openai/agents";
import OpenAI from "openai";
import { initializePrivateTracing, privateTracingProcessor } from "../private-tracing";
import { runPortfolioAssistant, type AgentUseCases } from "../index";
import { assistantConfig } from "../config";

const privateMessage = "PRIVATE_PROVIDER_MESSAGE_CANARY";
const privateData = "PRIVATE_PROVIDER_DATA_CANARY";
const syntheticKey = "SYNTHETIC_NO_NETWORK_KEY";

function recordingProcessor() {
  const captured: unknown[] = [];
  const processor: TracingProcessor = {
    async onTraceStart(trace) { captured.push(trace.toJSON()); },
    async onTraceEnd(trace) { captured.push(trace.toJSON()); },
    async onSpanStart() {},
    async onSpanEnd(span) { captured.push(span.toJSON()); },
    async shutdown() {}, async forceFlush() {},
  };
  return { captured, processor };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sdk.setTracingDisabled(true);
  sdk.setTraceProcessors([]);
});

describe("private SDK trace errors", () => {
  it.each(["thrown_error", "http_400"] as const)("redacts real Responses model %s errors after the SDK captures them", async kind => {
    const recording = recordingProcessor();
    sdk.setTraceProcessors([privateTracingProcessor(recording.processor)]);
    sdk.setTracingDisabled(false);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: {
      message: privateMessage, type: "invalid_request_error", code: "synthetic_rejection",
    } }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const client = new OpenAI({ apiKey: syntheticKey, maxRetries: 0, fetch });
    class ThrowingResponsesModel extends OpenAIResponsesModel {
      protected override async _fetchResponse(): Promise<OpenAI.Responses.Response> {
        throw Object.assign(new Error(privateMessage), { name: "PRIVATE_ERROR_NAME_CANARY", data: { detail: privateData } });
      }
    }
    const model = kind === "http_400" ? new OpenAIResponsesModel(client, "synthetic-model") : new ThrowingResponsesModel(client, "synthetic-model");
    const config = assistantConfig({ ASSISTANT_RUNTIME: "agents", OPENAI_API_KEY: syntheticKey, ASSISTANT_MODEL: "synthetic-model", ASSISTANT_TRACING_ENABLED: "true" });
    await expect(runPortfolioAssistant({ userId: UserId.parse("PRIVATE_OWNER_CANARY"), body: { message: "PRIVATE_CHAT_CANARY" }, useCases: {} as AgentUseCases,
      config, model, requestId: "synthetic-request", source: "extension", observe: () => {} })).rejects.toMatchObject({ code: "ASSISTANT_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(kind === "http_400" ? 1 : 0);
    const spans = recording.captured.filter((item): item is { object: string; span_data: { type: string }; error: unknown; id: string; trace_id: string; started_at: string; ended_at: string } => item !== null && typeof item === "object" && "span_data" in item);
    expect(spans).toHaveLength(4);
    expect(spans.find(span => span.span_data.type === "response")?.error).toEqual({ message: "Assistant operation failed", data: { category: "operation_failed" } });
    for (const span of spans) {
      expect(span.id).toMatch(/^span_[a-zA-Z0-9]{24}$/);
      expect(span.trace_id).toMatch(/^trace_[a-zA-Z0-9]{32}$/);
      expect(span.started_at).toEqual(expect.any(String));
      expect(span.ended_at).toEqual(expect.any(String));
    }
    const serialized = JSON.stringify(recording.captured);
    expect(serialized).not.toContain("synthetic-request");
    expect(serialized).toContain("run_id");
    expect(serialized).toContain("extension");
    expect(serialized).not.toMatch(/PRIVATE_|SYNTHETIC_NO_NETWORK_KEY/);
  });

  it("sanitizes start and end clones without changing the original span or safe metadata", async () => {
    const recording = recordingProcessor();
    const downstream: sdk.Span<sdk.SpanData>[] = [];
    const delegate = { ...recording.processor, onSpanStart: vi.fn(async (span: sdk.Span<sdk.SpanData>) => { downstream.push(span); }),
      onSpanEnd: vi.fn(async (span: sdk.Span<sdk.SpanData>) => { downstream.push(span); }) };
    const original = new Span({ traceId: `trace_${"a".repeat(32)}`, spanId: `span_${"b".repeat(24)}`, parentId: `span_${"c".repeat(24)}`,
      startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T12:00:01Z", data: { type: "task", name: "PointUp portfolio assistant",
        usage: { requests: 2, input_tokens: 20, output_tokens: 10, total_tokens: 30, cached_input_tokens: 8, cache_write_input_tokens: 0 } },
      error: { message: privateMessage, data: { detail: privateData } } }, recording.processor);
    const safe = privateTracingProcessor(delegate);
    await safe.onSpanStart(original);
    await safe.onSpanEnd(original);
    expect(downstream).toHaveLength(2);
    for (const copy of downstream) {
      expect(copy).not.toBe(original);
      expect(copy.toJSON()).toEqual({ ...original.toJSON(), error: { message: "Assistant operation failed", data: { category: "operation_failed" } } });
      expect(copy.spanData).toEqual(original.spanData);
    }
    expect(original.error).toEqual({ message: privateMessage, data: { detail: privateData } });
    const successful = new Span({ traceId: original.traceId, data: { type: "response", response_id: "resp_synthetic" } }, recording.processor);
    await safe.onSpanEnd(successful);
    expect(downstream.at(-1)?.error).toBeNull();
    expect(downstream.at(-1)?.toJSON()).toEqual(successful.toJSON());
  });

  it("retains the delegate's trace lifecycle, flush and bounded shutdown", async () => {
    const delegate: TracingProcessor = { start: vi.fn(), onTraceStart: vi.fn(async () => {}), onTraceEnd: vi.fn(async () => {}),
      onSpanStart: vi.fn(async () => {}), onSpanEnd: vi.fn(async () => {}), forceFlush: vi.fn(async () => {}), shutdown: vi.fn(async () => {}) };
    const safe = privateTracingProcessor(delegate);
    const trace = new sdk.Trace({ name: "Synthetic trace" });
    safe.start?.();
    await safe.onTraceStart(trace);
    await safe.onTraceEnd(trace);
    await safe.forceFlush();
    await safe.shutdown(3000);
    expect(delegate.start).toHaveBeenCalledTimes(1);
    expect(delegate.onTraceStart).toHaveBeenCalledWith(trace);
    expect(delegate.onTraceEnd).toHaveBeenCalledWith(trace);
    expect(delegate.forceFlush).toHaveBeenCalledTimes(1);
    expect(delegate.shutdown).toHaveBeenCalledWith(3000);
  });

  it("respects global disable and installs once across concurrent calls and module reloads", async () => {
    const replace = vi.spyOn(sdk.getGlobalTraceProvider(), "setProcessors").mockImplementation(() => {});
    vi.stubEnv("OPENAI_AGENTS_DISABLE_TRACING", "1");
    initializePrivateTracing();
    vi.stubEnv("OPENAI_AGENTS_DISABLE_TRACING", "true");
    initializePrivateTracing();
    expect(replace).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_AGENTS_DISABLE_TRACING", "0");
    await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(initializePrivateTracing)));
    expect(replace).toHaveBeenCalledTimes(1);
    const installed = replace.mock.calls[0]?.[0];
    expect(installed).toHaveLength(1);
    vi.resetModules();
    const reloaded = await import("../private-tracing");
    reloaded.initializePrivateTracing();
    expect(replace).toHaveBeenCalledTimes(1);
    await installed?.[0]?.shutdown(1000);
  });
});
