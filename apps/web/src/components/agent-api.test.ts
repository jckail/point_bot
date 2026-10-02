import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentApiError, agentRequest, requestReviewedAction } from "./agent-api";

afterEach(() => vi.unstubAllGlobals());
describe("browser agent management requests", () => {
  it("approves only an encoded persisted action ID, without accepting a replacement payload", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ action: { status: "succeeded" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await requestReviewedAction("owned/action?points=999", "approve");
    expect(fetch).toHaveBeenCalledWith("/api/v1/assistant/actions/owned%2Faction%3Fpoints%3D999/approve", expect.objectContaining({
      method: "POST", body: "{}", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-PointUp-Surface": "web" }, signal: expect.any(AbortSignal),
    }));
  });
  it("exposes support correlation only on failed requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Proposal expired" } }), { status: 409, headers: { "X-PointUp-Request-Id": "support-123" } })));
    await expect(agentRequest("/api/v1/assistant/actions")).rejects.toMatchObject({ message: "Proposal expired", requestId: "support-123" });
  });
  it("preserves the canonical PR14 support header when both diagnostics are present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Use your browser" } }), { status: 403, headers: { "x-request-id": "canonical-support", "X-PointUp-Request-Id": "sdk-support" } })));
    await expect(agentRequest("/api/v1/assistant/actions")).rejects.toMatchObject({ message: "Use your browser", requestId: "canonical-support" });
  });
  it("turns an unexpected non-JSON failure into a recoverable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream failure", { status: 502 })));
    await expect(agentRequest("/api/v1/agents/tokens")).rejects.toBeInstanceOf(AgentApiError);
  });
});
