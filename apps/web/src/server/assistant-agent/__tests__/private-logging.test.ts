import { createRequire } from "node:module";
import { UserId } from "@pointup/core";
import { OpenAIResponsesModel, getLogger, setSensitiveDataLoggingEnabled, setTraceProcessors, setTracingDisabled, type TracingProcessor } from "@openai/agents";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPortfolioAssistant, type AgentUseCases, type Observation } from "../index";
import { assistantConfig } from "../config";
import { privateTracingProcessor } from "../private-tracing";
import { runEvaluationCase } from "../evaluation/run";
import { evaluationCases } from "../evaluation/cases";

// Resolve the actual SDK logger's installed debug dependency; no new package.
interface DebugControl { enable: (namespaces: string) => void; disable: () => string }
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("@openai/agents-core"));
const debug: DebugControl = sdkRequire("debug");
const canaries = ["PRIVATE_PROMPT_CANARY", "PRIVATE_HISTORY_CANARY", "PRIVATE_TOOL_CANARY", "PRIVATE_RESPONSE_CANARY"];
const logs: string[] = [];
let previousDebug = "";

beforeEach(() => {
  logs.length = 0;
  previousDebug = debug.disable();
  debug.enable("openai-agents:*");
  vi.stubEnv("DEBUG", "openai-agents:*");
  vi.stubEnv("OPENAI_LOG", "debug");
  vi.stubEnv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "false");
  vi.stubEnv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "false");
  vi.stubEnv("OPENAI_AGENTS_DISABLE_TRACING", "0");
  // Hostile prior programmatic opt-in must not defeat the app's privacy policy.
  setSensitiveDataLoggingEnabled(true);
  setTracingDisabled(true);
  setTraceProcessors([]);
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => { logs.push(String(chunk)); return true; });
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { logs.push(String(chunk)); return true; });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw new Error("Unexpected outbound transport"); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  debug.enable(previousDebug);
  setSensitiveDataLoggingEnabled(false);
  setTracingDisabled(true);
  setTraceProcessors([]);
});

function responsesModel() {
  const requests: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    expect(url).toBe("https://api.openai.com/v1/responses");
    requests.push(String(init?.body));
    const first = requests.length === 1;
    return new Response(JSON.stringify({
      id: first ? "resp_synthetic_first" : "resp_synthetic_second", object: "response", created_at: 1,
      status: "completed", model: "synthetic-model",
      output: first
        ? [{ type: "function_call", id: "fc_synthetic", call_id: "call_synthetic", name: "trip_goals", arguments: "{}", status: "completed" }]
        : [{ type: "message", id: "msg_synthetic", role: "assistant", status: "completed", content: [{ type: "output_text", text: "PRIVATE_RESPONSE_CANARY", annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = new OpenAI({ apiKey: "SYNTHETIC_NO_NETWORK_KEY", maxRetries: 0, fetch: fetchMock });
  return { model: new OpenAIResponsesModel(client, "synthetic-model"), requests, fetchMock };
}

function useCases() {
  return { listTripGoals: { execute: vi.fn().mockResolvedValue([
    { title: "PRIVATE_TOOL_CANARY", targetPoints: 100, targetDate: null, status: "active", currentPoints: 50, remainingPoints: 50, percentComplete: 50 },
  ]) } } as unknown as AgentUseCases;
}

const config = assistantConfig({ ASSISTANT_RUNTIME: "agents", OPENAI_API_KEY: "SYNTHETIC_NO_NETWORK_KEY", ASSISTANT_MODEL: "synthetic-model" });

describe("actual SDK debug sink privacy", () => {
  it.each([false, true])("keeps request/history/tool/response data private with tracing %s", async tracing => {
    if (tracing) {
      const processor: TracingProcessor = {
        async onTraceStart() {}, async onTraceEnd() {}, async onSpanStart() {}, async onSpanEnd() {},
        async shutdown() {}, async forceFlush() {},
      };
      setTraceProcessors([privateTracingProcessor(processor)]);
      setTracingDisabled(false);
    }
    const f = responsesModel(); const cases = useCases(); const events: Observation[] = [];
    const result = await runPortfolioAssistant({
      userId: UserId.parse("synthetic-log-owner"),
      body: { message: "PRIVATE_PROMPT_CANARY", history: [{ role: "user", content: "PRIVATE_HISTORY_CANARY" }] },
      model: f.model, useCases: cases, config: { ...config, tracing }, observe: event => events.push(event),
      requestId: "synthetic-support-reference",
    });
    expect(result.reply).toBe("PRIVATE_RESPONSE_CANARY");
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect(cases.listTripGoals.execute).toHaveBeenCalledWith("synthetic-log-owner");
    const sent = f.requests.join("\n");
    for (const marker of canaries.slice(0, 3)) expect(sent).toContain(marker);
    const captured = logs.join("\n");
    expect(captured).toContain("Calling LLM"); // Actual SDK debug sink was active.
    for (const marker of canaries) expect(captured).not.toContain(marker);
    expect(captured).not.toContain("SYNTHETIC_NO_NETWORK_KEY");
    expect(result.requestId).toBe("synthetic-support-reference");
    expect(Boolean(result.traceId)).toBe(tracing);
    expect(events.some(event => event.event === "tool_completed" && event.status === "success")).toBe(true);
    expect(events.find(event => event.event === "run_usage")).toMatchObject({ modelRequests: 2, inputTokens: 20, outputTokens: 10 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reasserts both logging flags before the legacy callback even with tracing disabled", async () => {
    vi.stubEnv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "0");
    vi.stubEnv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "0");
    const execute = vi.fn(async () => {
      const logger = getLogger("openai-agents:synthetic-fallback");
      expect(logger.dontLogModelData).toBe(true);
      expect(logger.dontLogToolData).toBe(true);
      return { reply: "Existing fallback" };
    });
    const result = await runPortfolioAssistant({ userId: UserId.parse("synthetic-log-owner"), body: { message: "PRIVATE_PROMPT_CANARY" },
      useCases: { chatWithAssistant: { execute } } as unknown as AgentUseCases,
      config: { ...config, runtime: "legacy", tracing: false }, observe: () => {}, });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Existing fallback");
    expect(result.traceId).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("enforces the same policy through the real synthetic evaluation runtime without export", async () => {
    const testCase = evaluationCases[0];
    if (!testCase) throw new Error("Missing synthetic evaluation case");
    const f = responsesModel();
    const result = await runEvaluationCase(testCase, { modelName: "synthetic-model", model: f.model, tracing: true });
    expect(result.usageAvailable).toBe(true);
    expect(result.modelRequests).toBe(2);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain("Calling LLM");
    expect(logs.join("\n")).not.toContain("PRIVATE_RESPONSE_CANARY");
    expect(getLogger("openai-agents:synthetic-evaluation").dontLogModelData).toBe(true);
    expect(getLogger("openai-agents:synthetic-evaluation").dontLogToolData).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
