import { AccessTokenId, ObservationReplayConflictError, UserId } from "@pointup/core";
import { httpStatusForErrorCode } from "@pointup/core/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorize, assertCsrfSafe, mapError, type Principal } from "@/server/access-policy";
const state = vi.hoisted(() => {
  const principal: Principal = { userId: "owner-one" as UserId, scopes: "session" };
  return { principal, origin: "https://pointup.test", submit: vi.fn(), confirm: vi.fn(), reject: vi.fn(), invalidate: vi.fn() };
});
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { submitObservation: { execute: state.submit }, resolveObservationReview: { confirm: state.confirm, reject: state.reject } } }) }));
vi.mock("@/server/read-cache", () => ({ getReadCache: () => ({ invalidateTag: state.invalidate }) }));
vi.mock("@/server/http", () => ({ withAuthenticatedUser: async (handler: (owner: UserId, principal: Principal) => Promise<Response>, options: Parameters<typeof authorize>[1]) => {
  try {
    authorize(state.principal, options);
    assertCsrfSafe({ method: "POST", principal: state.principal, origin: state.origin, expectedOrigin: "https://pointup.test", contentType: "application/json", hasBody: false, secFetchSite: null });
    return await handler(state.principal.userId, state.principal);
  } catch (error) {
    const mapped = mapError(error);
    return Response.json(mapped, { status: httpStatusForErrorCode(mapped.code) });
  }
} }));
import { POST } from "./route";
import { POST as confirm } from "./[id]/confirm/route";
import { POST as reject } from "./[id]/reject/route";
const owner = UserId.parse("owner-one");
const captureId = "123e4567-e89b-42d3-a456-426614174000";
const body = { skillId: "synthetic-skill", points: 2000, sourceUrl: "https://provider.test/points", agent: "synthetic", observedAt: "2026-10-01T00:00:00Z", captureId, sourceMethod: "page_capture" };
const receipt = { outcome: "recorded", accountId: "account-one", points: 2000, previousPoints: 1000, message: "Recorded", reviewId: null, observationId: "receipt-one" };
const context = { params: Promise.resolve({ id: "review-one" }) };
function request(value?: unknown) { return new Request("https://pointup.test/api/v1/agent/observations", { method: "POST", headers: { "content-type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }); }
beforeEach(() => {
  vi.resetAllMocks(); state.principal = { userId: owner, scopes: "session" }; state.origin = "https://pointup.test";
  state.submit.mockResolvedValue(receipt); state.confirm.mockResolvedValue(receipt); state.reject.mockResolvedValue({ ...receipt, outcome: "rejected" }); state.invalidate.mockResolvedValue(undefined);
});
describe("observation wire and trusted provenance", () => {
  it.each(["session", "clerk_bearer", "personal_access_token"])("binds %s from resolver and preserves replay claims", async kind => {
    if (kind === "clerk_bearer") state.principal = { userId: owner, scopes: "session", credential: "clerk-bearer" };
    if (kind === "personal_access_token") state.principal = { userId: owner, scopes: ["observations:write"], tokenId: AccessTokenId.parse("token-one") };
    const response = await POST(request(body)); expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ userId: owner, captureId, sourceMethod: "page_capture", observedAt: new Date(body.observedAt), credential: kind === "personal_access_token" ? { kind, tokenId: "token-one" } : { kind }, canLinkAccount: kind !== "personal_access_token" }));
  });
  it("returns replay conflicts as 409 without running a second write", async () => {
    state.submit.mockRejectedValueOnce(new ObservationReplayConflictError());
    const response = await POST(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OBSERVATION_REPLAY_CONFLICT" });
    expect(state.submit).toHaveBeenCalledTimes(1);
  });
  it("omits private provenance even if a service accidentally returns extra fields", async () => {
    state.submit.mockResolvedValueOnce({ ...receipt, accessTokenId: "private", payloadHash: "private", credentialKind: "personal_access_token", consentId: "private" });
    expect(await (await POST(request(body))).json()).toEqual(receipt);
  });
  it("preserves legacy omissions without inserting timestamps", async () => {
    await POST(request({ skillId: body.skillId, points: body.points, sourceUrl: body.sourceUrl }));
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ captureId: undefined, sourceMethod: undefined, observedAt: undefined, agent: "unknown" }));
  });
  it.each([{ captureId: "invalid" }, { sourceMethod: "verified" }, { credential: { kind: "session" } }, { tokenId: "forged" }, { provenanceVersion: 1 }, { consentId: "forged" }])("refuses malformed or forged fields %j", async overrides => {
    expect((await POST(request({ ...body, ...overrides }))).status).toBe(400); expect(state.submit).not.toHaveBeenCalled();
  });
  it("bounds chunked JSON before service execution", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(20_000)); controller.enqueue(new Uint8Array(20_000)); controller.close(); } });
    const init: RequestInit & { duplex: string } = { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" };
    expect((await POST(new Request("https://pointup.test", init))).status).toBe(413); expect(state.submit).not.toHaveBeenCalled();
  });
});
describe("human observation decisions", () => {
  it.each([confirm, reject])("retains bodyless compatibility and refuses replacement values", async decide => {
    expect((await decide(request(), context)).status).toBe(200); expect((await decide(request({ points: 9999 }), context)).status).toBe(400);
    expect(decide === confirm ? state.confirm : state.reject).toHaveBeenCalledTimes(1);
  });
  it.each([confirm, reject])("refuses PAT, Clerk bearer and cross-origin cookie authority", async decide => {
    state.principal = { userId: owner, scopes: ["observations:write"], tokenId: AccessTokenId.parse("token-one") }; expect((await decide(request(), context)).status).toBe(403);
    state.principal = { userId: owner, scopes: "session", credential: "clerk-bearer" }; expect((await decide(request(), context)).status).toBe(403);
    state.principal = { userId: owner, scopes: "session" }; state.origin = "https://foreign.test"; expect((await decide(request(), context)).status).toBe(403);
    expect(state.confirm).not.toHaveBeenCalled(); expect(state.reject).not.toHaveBeenCalled();
  });
  it("invalidates only the confirming owner's cache after success or uncertain failure", async () => {
    await confirm(request(), context); state.confirm.mockRejectedValueOnce(new Error("synthetic private failure")); expect((await confirm(request(), context)).status).toBe(500);
    expect(state.invalidate.mock.calls).toEqual([["user:owner-one"], ["user:owner-one"]]); await reject(request(), context); expect(state.invalidate).toHaveBeenCalledTimes(2);
  });
});
