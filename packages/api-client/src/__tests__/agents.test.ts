import { describe, expect, it, vi } from "vitest";
import { agentConsentDtoSchema, agentObservationDtoSchema, agentTokenDtoSchema } from "@pointup/core/agent-contracts";
import { assistantActionDtoSchema } from "@pointup/core/assistant-actions";
import { PointUpClient } from "../index";

const id = "aabbccdd-1234-4567-89ab-aabbccddeeff";
const date = "2026-10-01T12:00:00.000Z";
const expiry = "2026-10-20T12:00:00.000Z";
const token = agentTokenDtoSchema.parse({ id, label: "Extension", scopes: ["portfolio:read", "observations:write"], createdAt: date, expiresAt: expiry, revokedAt: null, lastUsedAt: null });
const consent = agentConsentDtoSchema.parse({ id, accountId: id, providerId: "united", grantedAt: date, expiresAt: expiry, revokedAt: null });
const observation = agentObservationDtoSchema.parse({ id, accountId: id, providerId: "united", points: 5000, capturedAt: date, sourceHost: "www.united.com", sourceMethod: "page_capture", status: "held", holdReason: "large_change", createdAt: date, reviewedAt: null });
const action = assistantActionDtoSchema.parse({ id, kind: "manual_balance", payload: { accountId: id, providerId: "united", providerName: "United MileagePlus", points: 5000, capturedAt: date }, status: "pending", title: "Review balance", summary: "Record observed points", createdAt: date, updatedAt: date, expiresAt: expiry, result: null, failureCode: null });
function setup(responses: Response[], bearer?: string) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return { fetch, client: new PointUpClient({ baseUrl: "https://pointup.io", credentials: "include", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, fetch }) };
}
function expectCall(fetch: ReturnType<typeof setup>["fetch"], index: number, method: string, path: string, body?: unknown) {
  const [url, init] = fetch.mock.calls[index]!;
  expect(url).toBe(`https://pointup.io/api/v1/${path}`);
  expect(init).toMatchObject({ method, credentials: "include", redirect: "error" });
  expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
}

describe("agent and action HTTP contracts", () => {
  it("uses exact token metadata and one-time secret envelopes", async () => {
    const { client, fetch } = setup([Response.json([token]), Response.json({ token: "pu_example", metadata: token }, { status: 201 }), Response.json({ revoked: true })]);
    expect(await client.listAgentTokens()).toEqual([token]);
    const input = { label: "Extension", scopes: token.scopes, expiresAt: expiry };
    expect(await client.mintAgentToken(input)).toEqual({ token: "pu_example", metadata: token });
    expect(await client.revokeAgentToken(id)).toEqual({ revoked: true });
    expectCall(fetch, 0, "GET", "agents/tokens");
    expectCall(fetch, 1, "POST", "agents/tokens", input);
    expectCall(fetch, 2, "DELETE", `agents/tokens/${id}`);
  });
  it("uses account-bound consent metadata without an owner supplied by the client", async () => {
    const { client, fetch } = setup([Response.json([consent]), Response.json(consent, { status: 201 }), Response.json({ revoked: true })]);
    expect(await client.listAgentConsents()).toEqual([consent]);
    const input = { accountId: id, expiresAt: expiry };
    expect(await client.grantAgentConsent(input)).toEqual(consent);
    expect(await client.revokeAgentConsent(id)).toEqual({ revoked: true });
    expectCall(fetch, 0, "GET", "agents/consents");
    expectCall(fetch, 1, "POST", "agents/consents", input);
    expectCall(fetch, 2, "DELETE", `agents/consents/${id}`);
  });
  it("returns a held 202 observation without wrapping or retrying it", async () => {
    const { client, fetch } = setup([Response.json(observation, { status: 202 })], "pu_example");
    const input = { observationId: id, accountId: id, providerId: "united", points: 5000, capturedAt: date, sourceUrl: "https://www.united.com/en/us/account", sourceMethod: "page_capture" as const };
    expect(await client.submitAgentObservation(input)).toEqual(observation);
    expectCall(fetch, 0, "POST", "agents/observations", input);
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: "Bearer pu_example" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("lists and reviews observations through the exact browser review paths", async () => {
    const reviewed = { ...observation, status: "accepted", reviewedAt: date };
    const { client, fetch } = setup([Response.json([observation]), Response.json(reviewed)]);
    expect(await client.listAgentObservations()).toEqual([observation]);
    expect(await client.reviewAgentObservation(id, "approve")).toEqual(reviewed);
    expectCall(fetch, 0, "GET", "agents/observations");
    expectCall(fetch, 1, "POST", `agents/observations/${id}/review`, { decision: "approve" });
  });
  it("keeps action proposal and decision envelopes distinct from execution requests", async () => {
    const { client, fetch } = setup([Response.json({ actions: [action] }), Response.json({ action }, { status: 201 }), Response.json({ action: { ...action, status: "succeeded" } }), Response.json({ action: { ...action, status: "rejected" } })]);
    expect(await client.listAssistantActions()).toEqual({ actions: [action] });
    const input = { kind: "manual_balance" as const, accountId: id, points: 5000 };
    expect(await client.proposeAssistantAction(input)).toEqual({ action });
    await client.decideAssistantAction(id, "approve");
    await client.decideAssistantAction("a/b?c#d", "reject");
    expectCall(fetch, 0, "GET", "assistant/actions");
    expectCall(fetch, 1, "POST", "assistant/actions", input);
    expectCall(fetch, 2, "POST", `assistant/actions/${id}/approve`, {});
    expectCall(fetch, 3, "POST", "assistant/actions/a%2Fb%3Fc%23d/reject", {});
  });
  it.each([[401, "AGENT_TOKEN_INVALID"], [403, "OBSERVATION_CONSENT_REQUIRED"], [409, "OBSERVATION_CONFLICT"]])("preserves %s policy errors without retry", async (status, code) => {
    const { client, fetch } = setup([Response.json({ error: { code, message: "Request denied" } }, { status })], "pu_example");
    await expect(client.submitAgentObservation({ observationId: id, accountId: id, providerId: "united", points: 5000, capturedAt: date, sourceUrl: "https://www.united.com/account", sourceMethod: "page_capture" })).rejects.toMatchObject({ name: "PointUpApiError", status, code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
