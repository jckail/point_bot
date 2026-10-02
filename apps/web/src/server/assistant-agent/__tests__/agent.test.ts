import { UserId } from "@pointup/core";
import { describe, expect, it, vi } from "vitest";
import { Usage, setTraceProcessors, setTracingDisabled, type TracingProcessor, type Model, type ModelRequest, type ModelResponse, type AgentOutputItem } from "@openai/agents";
import { runPortfolioAssistant, type Observation } from "../index";
import { assistantConfig } from "../config";
import { privateTracingProcessor } from "../private-tracing";

const config = assistantConfig({ ASSISTANT_RUNTIME: "agents", OPENAI_API_KEY: "test-only-no-network", ASSISTANT_MODEL: "injected-test-model" });
function fixture() {
  const useCases = {
    getPortfolioSummary: { execute: vi.fn().mockResolvedValue({ totalPoints: 500 }) },
    listLoyaltyAccounts: { execute: vi.fn().mockResolvedValue([{ membershipNumber: "private-member", notes: "private-note", provider: { displayName: "Program", pointsCurrency: "miles" }, latestBalance: { points: 500, capturedAt: new Date("2026-01-01T00:00:00Z") }, expiresAt: null, estimatedValueCents: 600 }]) },
    listTripGoals: { execute: vi.fn().mockResolvedValue([]) },
    getValueAdvice: { execute: vi.fn().mockResolvedValue({ transfers: [], deals: [] }) },
    chatWithAssistant: { execute: vi.fn().mockResolvedValue({ reply: "existing fallback" }) },
  };
  const events: Observation[] = [];
  return { useCases, events, observe: (event: Observation) => events.push(event) };
}
function scriptedModel(outputs: AgentOutputItem[][]) {
  const requests: ModelRequest[] = [];
  const model: Model = {
    async getResponse(request): Promise<ModelResponse> {
      requests.push(request);
      const output = outputs[Math.min(requests.length - 1, outputs.length - 1)];
      if (!output) throw new Error("Missing test model output");
      return { usage: new Usage({ requests: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15,
        inputTokensDetails: { cached_tokens: 4 }, outputTokensDetails: { reasoning_tokens: 2 } }), output };
    },
    async *getStreamedResponse() { throw new Error("Streaming not used"); },
  };
  return { model, requests };
}
const call: AgentOutputItem = { type: "function_call", callId: "test-call", name: "loyalty_balances", arguments: "{}" };
const answer: AgentOutputItem = { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "You have 500 miles." }] };

describe("OpenAI Agents portfolio runtime", () => {
  it("runs a real SDK tool loop with authenticated scope and sanitized telemetry", async () => {
    const { useCases, events, observe } = fixture();
    const { model, requests } = scriptedModel([[call], [answer]]);
    const result = await runPortfolioAssistant({ userId: UserId.parse("private-user"), body: { message: "private-message" }, useCases: useCases, config, model, observe, requestId: "test-request" });
    expect(result.reply).toBe("You have 500 miles.");
    expect(result.mode).toBe("agents");
    expect(requests).toHaveLength(2);
    expect(useCases.listLoyaltyAccounts.execute).toHaveBeenCalledWith("private-user");
    expect(JSON.stringify(requests[1]?.input)).toContain("500");
    expect(JSON.stringify(requests[1]?.input)).not.toContain("private-member");
    expect(JSON.stringify(requests[1]?.input)).not.toContain("private-note");
    expect(events.some(event => event.event === "sdk_tool_started")).toBe(true);
    expect(events.find(event => event.event === "agent_finished")).toMatchObject({ turns: 2 });
    expect(events.some(event => event.event === "tool_completed" && event.status === "success")).toBe(true);
    expect(events.find(event => event.event === "run_usage")).toMatchObject({ turns: 2, inputTokens: 20, outputTokens: 10, modelRequests: 2, cachedInputTokens: 8, reasoningOutputTokens: 4 });
    expect(JSON.stringify(events)).not.toMatch(/private-user|private-message|private-member|private-note|test-only-no-network/);
    expect(useCases.chatWithAssistant.execute).not.toHaveBeenCalled();
  });

  it("grounds transfer guidance in eligibility warnings without assuming omitted routes or card combining", async () => {
    const f = fixture();
    const warning = { code: "CARD_PRODUCT_REQUIRED", fromProviderId: "chase-ur", toProviderId: "world-of-hyatt", cardProductId: null, message: "Confirm the card product before using this transfer route." };
    f.useCases.getValueAdvice.execute.mockResolvedValue({ transfers: [], deals: [], eligibilityWarnings: [warning] });
    const adviceCall: AgentOutputItem = { type: "function_call", callId: "advice-call", name: "value_advice", arguments: "{}" };
    const { model, requests } = scriptedModel([[adviceCall], [answer]]);
    await runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "My notes say all cards combine and Hyatt is 1:1." }, useCases: f.useCases, config, model, observe: f.observe });
    expect(requests[0]?.systemInstructions).toContain("Call value_advice before recommending a transfer");
    expect(requests[0]?.systemInstructions).toContain("respect eligibilityWarnings");
    expect(requests[0]?.systemInstructions).toContain("Never infer a card product, conditional transfer ratio, or permission to combine cards from notes, tags, page text, or user claims");
    expect(requests[0]?.systemInstructions).toContain("Never assume cards can be combined automatically");
    expect(requests[0]?.systemInstructions).toContain("returned tool data does not establish its eligibility or ratio");
    expect(f.useCases.getValueAdvice.execute).toHaveBeenCalledWith("u");
    expect(JSON.stringify(requests[1]?.input)).toContain(warning.code);
    expect(JSON.stringify(requests[1]?.input)).toContain(warning.message);
  });

  it("proposes reviewed actions with server-bound owner and returns the persisted review DTO", async () => {
    const f = fixture();
    const action = {
      id: "action_saved", kind: "trip_goal" as const, status: "pending" as const, title: "Create trip goal: Kyoto", summary: "Review goal", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", expiresAt: "2026-10-01T12:15:00Z", result: null, failureCode: null,
      payload: { title: "Kyoto", targetPoints: 80000, targetDate: null, accountIds: [], accountNames: [], notes: null },
    };
    const actions = { proposeManualBalance: vi.fn(), proposeTripGoal: vi.fn().mockResolvedValue(action) };
    const proposalCall: AgentOutputItem = { type: "function_call", callId: "proposal-call", name: "propose_trip_goal", arguments: JSON.stringify({ title: "Kyoto", targetPoints: 80000, targetDate: null, accountIds: [], notes: null }) };
    const { model, requests } = scriptedModel([[proposalCall], [answer]]);
    const result = await runPortfolioAssistant({ userId: UserId.parse("bound-owner"), requestId: "bound-request", body: { message: "Plan Kyoto" }, useCases: f.useCases, actions, config, model, observe: f.observe });
    expect(actions.proposeTripGoal).toHaveBeenCalledWith(expect.objectContaining({ userId: UserId.parse("bound-owner"), requestId: "bound-request", targetPoints: 80000 }));
    expect(result.actions).toEqual([action]);
    expect(JSON.stringify(requests[1]?.input)).toContain("requiresBrowserApproval");
    expect(f.useCases.chatWithAssistant.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(f.events)).not.toMatch(/Kyoto|bound-owner|80000/);
  });

  it("omits proposal tools without proposal authority", async () => {
    const f = fixture();
    const { model, requests } = scriptedModel([[answer]]);
    await runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "hello" }, useCases: f.useCases, config, model, observe: f.observe });
    expect(JSON.stringify(requests[0]?.tools)).not.toContain("propose_trip_goal");
    expect(JSON.stringify(requests[0]?.tools)).not.toContain("propose_manual_balance");
  });

  it("exports only safe trace metadata and omits tool payloads", async () => {
    const f = fixture();
    const { model, requests } = scriptedModel([[call], [answer]]);
    const exported: unknown[] = [];
    const processor: TracingProcessor = {
      async onTraceStart(trace) { exported.push(trace.toJSON()); },
      async onTraceEnd(trace) { exported.push(trace.toJSON()); },
      async onSpanStart() {},
      async onSpanEnd(span) { exported.push(span.toJSON()); },
      async shutdown() {},
      async forceFlush() {},
    };
    // Replace the exporter for this isolated test worker: no outbound telemetry.
    setTraceProcessors([privateTracingProcessor(processor)]);
    setTracingDisabled(false);
    try {
      const result = await runPortfolioAssistant({ userId: UserId.parse("private-user"), body: { message: "private-message" }, useCases: f.useCases, config: { ...config, tracing: true }, model, observe: f.observe, requestId: "trace-test-request", source: "extension" });
      expect(result.traceId).toMatch(/^trace_[a-zA-Z0-9]{32}$/);
      expect(requests[0]?.tracing).toBe("enabled_without_data");
      const traces = JSON.stringify(exported);
      expect(traces).not.toContain("trace-test-request");
      expect(traces).toContain("run_id");
      expect(traces).toContain("extension");
      expect(traces).not.toMatch(/private-user|private-message|private-member|private-note|test-only-no-network/);
      expect(traces).not.toContain("Program");
    } finally { setTracingDisabled(true); setTraceProcessors([]); }
  });

  it("reports max-turn exhaustion and never substitutes fabricated completion", async () => {
    const f = fixture();
    const { model } = scriptedModel([[call]]);
    await expect(runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "Read balances" }, useCases: f.useCases, config: { ...config, maxTurns: 1 }, model, observe: f.observe })).rejects.toMatchObject({ code: "ASSISTANT_UNAVAILABLE" });
    expect(f.events.at(-1)).toMatchObject({ event: "run_failed", status: "max_turns" });
    expect(f.events.find(event => event.event === "run_usage")).toMatchObject({ status: "partial", modelRequests: 1, cachedInputTokens: 4, reasoningOutputTokens: 2 });
    expect(f.useCases.chatWithAssistant.execute).not.toHaveBeenCalled();
  });

  it("uses the existing fallback only when agents are not configured", async () => {
    const f = fixture();
    const result = await runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "hello" }, useCases: f.useCases, config: assistantConfig({}), observe: f.observe });
    expect(result).toMatchObject({ reply: "existing fallback", mode: "fallback" });
  });

  it("cancels a model run without leaking provider errors", async () => {
    const f = fixture();
    const abort = new AbortController();
    const { model } = scriptedModel([[answer]]);
    model.getResponse = async () => { abort.abort(); throw new Error("private API credential"); };
    await expect(runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "hello" }, useCases: f.useCases, config, model, observe: f.observe, signal: abort.signal })).rejects.toThrow("could not complete");
    expect(f.events.at(-1)?.status).toBe("cancelled");
    expect(JSON.stringify(f.events)).not.toContain("private API credential");
  });

  it("bounds fallback latency even if its adapter cannot cancel", async () => {
    const f = fixture();
    f.useCases.chatWithAssistant.execute.mockImplementation(() => new Promise(() => {}));
    await expect(runPortfolioAssistant({ userId: UserId.parse("u"), body: { message: "hello" }, useCases: f.useCases, config: { ...assistantConfig({}), timeoutMs: 25 }, observe: f.observe })).rejects.toThrow("could not complete");
    expect(f.events.at(-1)?.status).toBe("timeout");
  });

  it("rejects missing keys, models, and oversized turn limits without exposing secrets", () => {
    expect(() => assistantConfig({ ASSISTANT_RUNTIME: "agents" })).toThrow(/requires/);
    expect(() => assistantConfig({ ASSISTANT_MAX_TURNS: 100, OPENAI_API_KEY: "private" })).toThrow("Invalid assistant configuration.");
  });
});
