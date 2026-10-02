import { describe, expect, it, vi } from "vitest";
import { PointUpClient } from "./index";

const action = {
  id: "action-owned", kind: "manual_balance", status: "pending", title: "Record balance", summary: "Review balance",
  createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", expiresAt: "2026-10-01T10:15:00Z",
  payload: { accountId: "owned-account", providerId: "united", providerName: "United", points: 125000, capturedAt: "2026-10-01T09:30:00Z" },
  result: null, failureCode: null,
};

describe("reviewed assistant client", () => {
  it("preserves full proposals in chat replies and existing caller headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ reply: "Review this balance.", actions: [action] }));
    const client = new PointUpClient({ baseUrl: "https://pointup.example/", fetch, headers: { Authorization: "Bearer pu_example", "X-PointUp-Surface": "extension" }, timeoutMs: 25000 });
    const response = await client.chatWithAssistant({ message: "Record my balance" });
    expect(response.actions?.[0]).toEqual(action);
    expect(fetch).toHaveBeenCalledWith("https://pointup.example/api/v1/assistant/chat", expect.objectContaining({
      method: "POST", redirect: "error", body: JSON.stringify({ message: "Record my balance" }),
      headers: expect.objectContaining({ Authorization: "Bearer pu_example", "X-PointUp-Surface": "extension" }),
    }));
  });
  it("creates proposals without invoking approval or manual balance mutation endpoints", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ action }));
    const client = new PointUpClient({ baseUrl: "https://pointup.example", fetch });
    const proposal = { kind: "manual_balance" as const, accountId: "owned-account", points: 125000 };
    expect(await client.proposeAssistantAction(proposal)).toEqual({ action });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://pointup.example/api/v1/assistant/actions");
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(proposal));
  });
  it("lists proposals and approves only the encoded persisted ID with an empty payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ actions: [action] })).mockResolvedValueOnce(Response.json({ action: { ...action, status: "succeeded" } }));
    const client = new PointUpClient({ baseUrl: "https://pointup.example", fetch, credentials: "include" });
    expect(await client.listAssistantActions()).toEqual({ actions: [action] });
    await client.decideAssistantAction("owned/action?points=999", "approve");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://pointup.example/api/v1/assistant/actions/owned%2Faction%3Fpoints%3D999/approve");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: "{}", credentials: "include", redirect: "error" });
  });
  it("retains PR14 error correlation from the body and canonical x-request-id fallback", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ error: { code: "INSUFFICIENT_SCOPE", message: "Use your browser", requestId: "body-support-id" } }, { status: 403, headers: { "x-request-id": "header-support-id" } })).mockResolvedValueOnce(Response.json({ error: { code: "ASSISTANT_ACTION_NOT_FOUND", message: "Proposal not found" } }, { status: 404, headers: { "x-request-id": "header-support-id" } }));
    const client = new PointUpClient({ baseUrl: "https://pointup.example", fetch });
    await expect(client.decideAssistantAction("owned", "reject")).rejects.toMatchObject({ status: 403, code: "INSUFFICIENT_SCOPE", requestId: "body-support-id" });
    await expect(client.decideAssistantAction("missing", "approve")).rejects.toMatchObject({ status: 404, requestId: "header-support-id" });
  });
});
