import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserId, AccessTokenId } from "@pointup/core";
import { authorize, mapError, type Principal } from "@/server/access-policy";

const state = vi.hoisted(() => ({ list: vi.fn(), balance: vi.fn(), goal: vi.fn(), approve: vi.fn(), reject: vi.fn(), invalidate: vi.fn(), principal: { userId: "owner-one", scopes: "session" } as Principal }));
vi.mock("@/server/read-cache", () => ({ getReadCache: () => ({ invalidateTag: state.invalidate }) }));
vi.mock("next/server", () => ({ NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } }));
vi.mock("@/server/assistant-agent/actions", () => ({
  getAssistantActions: () => ({ list: state.list, proposeManualBalance: state.balance, proposeTripGoal: state.goal, approve: state.approve, reject: state.reject }),
  assistantActionResponse: async (operation: () => Promise<unknown>) => Response.json({ action: await operation() }),
}));
vi.mock("@/server/http", () => ({
  withAuthenticatedUser: async (handler: (owner: ReturnType<typeof UserId.parse>) => Promise<Response>, options: Parameters<typeof authorize>[1]) => {
    try {
      const principal = state.principal;
      authorize(principal, options);
      return await handler(principal.userId);
    } catch (error) {
      const mapped = mapError(error);
      return Response.json({ error: { code: mapped.code, message: mapped.message } }, { status: mapped.code === "INSUFFICIENT_SCOPE" ? 403 : mapped.code === "INTERNAL" ? 500 : 400 });
    }
  },
}));
import { GET, POST } from "./route";
import { POST as approve } from "./[actionId]/approve/route";
import { POST as reject } from "./[actionId]/reject/route";

const owner = UserId.parse("owner-one");
const cookie: Principal = { userId: owner, scopes: "session" };
const token = (scopes: Principal["scopes"]): Principal => ({ userId: owner, scopes, tokenId: AccessTokenId.parse("pat-one") });
const request = (body: unknown) => new Request("https://pointup.example/api/v1/assistant/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ actionId: "persisted-owned-action" }) };

beforeEach(() => {
  vi.resetAllMocks();
  state.principal = cookie;
  state.invalidate.mockResolvedValue(undefined);
  state.list.mockResolvedValue([]);
  state.balance.mockResolvedValue({ id: "new-proposal", status: "pending" });
  state.goal.mockResolvedValue({ id: "new-proposal", status: "pending" });
  state.approve.mockResolvedValue({ id: "persisted-owned-action", status: "succeeded" });
  state.reject.mockResolvedValue({ id: "persisted-owned-action", status: "rejected" });
});

describe("reviewed proposal route authority", () => {
  it("lists owned proposals for portfolio:read tokens with private cache control", async () => {
    state.principal = token(["portfolio:read"]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.list).toHaveBeenCalledWith(owner);
  });
  it("requires portfolio:write for proposals without executing them", async () => {
    state.principal = token(["portfolio:read"]);
    expect((await POST(request({ kind: "manual_balance", accountId: "account-one", points: 2000 }))).status).toBe(403);
    expect(state.balance).not.toHaveBeenCalled();
    state.principal = token(["portfolio:write"]);
    const response = await POST(request({ kind: "manual_balance", accountId: "account-one", points: 2000 }));
    expect(response.status).toBe(201);
    expect(state.balance).toHaveBeenCalledWith(expect.objectContaining({ userId: owner, accountId: "account-one", points: 2000, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) }));
    expect(state.approve).not.toHaveBeenCalled();
  });
  it("rejects model-supplied owner and execution fields", async () => {
    const response = await POST(request({ kind: "manual_balance", accountId: "account-one", points: 2000, userId: "foreign-owner", status: "succeeded" }));
    expect(response.status).toBe(400);
    expect(state.balance).not.toHaveBeenCalled();
  });
  it.each([approve, reject])("requires browser authority even for write PATs and verified Clerk bearers", async decide => {
    state.principal = token(["portfolio:write"]);
    expect((await decide(request({}), context)).status).toBe(403);
    state.principal = { ...cookie, credential: "clerk-bearer" };
    expect((await decide(request({}), context)).status).toBe(403);
    expect(state.approve).not.toHaveBeenCalled();
    expect(state.reject).not.toHaveBeenCalled();
  });
  it.each([approve, reject])("uses only the stored proposal ID and owner, refusing replacement values", async decide => {
    expect((await decide(request({ points: 999999, accountId: "replacement" }), context)).status).toBe(400);
    expect(state.approve).not.toHaveBeenCalled();
    expect(state.reject).not.toHaveBeenCalled();
    const response = await decide(request({}), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(decide === approve ? state.approve : state.reject).toHaveBeenCalledWith("persisted-owned-action", owner);
  });
  it("invalidates the owner's cached portfolio after approval or an uncertain partial write", async () => {
    expect((await approve(request({}), context)).status).toBe(200);
    expect(state.invalidate).toHaveBeenLastCalledWith("user:owner-one");
    state.approve.mockRejectedValueOnce(new Error("partial committed write"));
    expect((await approve(request({}), context)).status).toBe(500);
    expect(state.invalidate).toHaveBeenCalledTimes(2);
    expect(state.invalidate).toHaveBeenLastCalledWith("user:owner-one");
    await reject(request({}), context);
    expect(state.invalidate).toHaveBeenCalledTimes(2);
  });
});
