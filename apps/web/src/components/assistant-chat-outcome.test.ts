import { Usage, type Model } from "@openai/agents";
import { UserId } from "@pointup/core";
import { runPortfolioAssistant } from "../server/assistant-agent";
import { describe, expect, it, vi } from "vitest";
import { assistantChatFailure, assistantSupportId, AssistantChatRequestError, requestAssistantChat } from "./assistant-chat-outcome";

const clientId = "311ddc59-d7bc-4f1f-9716-cf196b1ca3c8";
const signal = () => new AbortController().signal;

describe("web assistant uncertain request recovery", () => {
  it("sends the client support reference and uses a validated server reference", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ reply: "Advice" }), { headers: { "x-request-id": "server-reference" } }));
    expect(await requestAssistantChat("{}", signal(), clientId, fetchImpl)).toEqual({ reply: "Advice", requestId: "server-reference" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/assistant/chat", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-request-id": clientId }) }));
  });
  it("preserves server references containing shared-contract dots and colons", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ reply: "Advice" }, { headers: { "x-request-id": "trace.run:1234" } }));
    expect((await requestAssistantChat("{}", signal(), clientId, fetchImpl)).requestId).toBe("trace.run:1234");
  });
  it("retains the sent reference on network failure without retrying or echoing raw errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("private provider exception"));
    const error = await requestAssistantChat("{}", signal(), clientId, fetchImpl).catch(error => error);
    expect(error).toBeInstanceOf(AssistantChatRequestError);
    expect(assistantChatFailure(error, false, false)).toMatchObject({ requestId: clientId });
    expect(assistantChatFailure(error, false, false).message).not.toContain("private");
    expect(assistantChatFailure(error, false, false).message).toContain("before explicitly retrying");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(["private/provider/body", "x".repeat(129), "Bearer private", ""])("refuses unsafe server support text: %s", async reference => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "private upstream body" } }), { status: 503, headers: { "x-request-id": reference } }));
    const error = await requestAssistantChat("{}", signal(), clientId, fetchImpl).catch(error => error);
    expect(assistantChatFailure(error, false, false).requestId).toBe(clientId);
    expect(assistantChatFailure(error, false, false).message).not.toContain("private");
  });
  it("preserves the server reference when JSON decoding fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("private non-JSON proxy body", { headers: { "X-PointUp-Request-Id": "safe-reference" } }));
    const error = await requestAssistantChat("{}", signal(), clientId, fetchImpl).catch(error => error);
    expect(assistantChatFailure(error, false, false).requestId).toBe("safe-reference");
  });
  it.each([[true, true, "too long"], [true, false, "stopped"], [false, false, "could not be confirmed"]] as const)("warns about proposals after abort=%s timeout=%s", (aborted, timedOut, phrase) => {
    const failure = assistantChatFailure(new AssistantChatRequestError(clientId), aborted, timedOut);
    expect(failure.message).toContain(phrase);
    expect(failure.message).toContain("A proposed change may still appear");
    expect(failure.message).toContain("Check proposed actions in PointUp");
  });
  it("reconciles a delayed SDK proposal after failed chat without resending or approving", async () => {
    const proposals: unknown[] = [];
    let finishProposal!: () => void;
    const saved = new Promise<void>(resolve => { finishProposal = resolve; });
    const action = { id: "action_late", kind: "trip_goal" as const, status: "pending" as const,
      title: "Synthetic", summary: "Review", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      expiresAt: new Date(900000).toISOString(), result: null, failureCode: null,
      payload: { title: "Synthetic", targetPoints: 10, targetDate: null, accountIds: [], accountNames: [], notes: null } };
    const proposeTripGoal = vi.fn(async () => { await saved; proposals.push(action); return action; });
    const model: Model = {
      getResponse: async () => ({ usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: [{
        type: "function_call", callId: "synthetic-call", name: "propose_trip_goal",
        arguments: JSON.stringify({ title: "Synthetic", targetPoints: 10, targetDate: null, accountIds: [], notes: null }),
      }] }),
      getStreamedResponse: async function* () { throw new Error("Unused controlled model stream"); },
    };
    const useCases = { getPortfolioSummary: { execute: vi.fn() }, listLoyaltyAccounts: { execute: vi.fn() },
      listTripGoals: { execute: vi.fn() }, getValueAdvice: { execute: vi.fn() }, chatWithAssistant: { execute: vi.fn() } };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (path === "/api/v1/assistant/actions") return Response.json({ actions: proposals });
      try {
        await runPortfolioAssistant({ userId: UserId.parse("synthetic"), body: { message: "Synthetic" },
          config: { runtime: "agents", model: "injected", apiKey: undefined, tracing: false, timeoutMs: 100, maxTurns: 2 },
          useCases, actions: { proposeManualBalance: vi.fn(), proposeTripGoal }, model, observe: () => {} });
        throw new Error("Unexpected completion before proposal save");
      } catch { return Response.json({ error: { code: "ASSISTANT_UNAVAILABLE" } }, { status: 503 }); }
    });
    const error = await requestAssistantChat("{}", signal(), clientId, fetchImpl).catch(error => error);
    expect(assistantChatFailure(error, false, false).message).toContain("before explicitly retrying");
    expect(proposeTripGoal).toHaveBeenCalledOnce();
    expect(proposals).toEqual([]);
    finishProposal(); await saved;
    await vi.waitFor(() => expect(proposals).toEqual([action]));
    const reconciled = await fetchImpl("/api/v1/assistant/actions", { method: "GET" });
    expect(await reconciled.json()).toEqual({ actions: [action] });
    expect(fetchImpl.mock.calls.filter(([path]) => path === "/api/v1/assistant/chat")).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([path]) => String(path).includes("/approve"))).toBe(false);
  });
  it("accepts only bounded identifier support references", () => {
    expect(assistantSupportId(clientId)).toBe(clientId);
    expect(assistantSupportId("trace.run:1234")).toBe("trace.run:1234");
    expect(assistantSupportId("short")).toBeUndefined();
    expect(assistantSupportId({})).toBeUndefined();
  });
});
