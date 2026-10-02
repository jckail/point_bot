import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const state = vi.hoisted(() => ({ session: vi.fn(), authenticate: vi.fn(), verifyToken: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.session, verifyToken: state.verifyToken }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./container", () => ({ getAgentServices: () => ({ authenticate: { execute: state.authenticate } }) }));
import { withAuthenticatedUser, withBrowserAuthenticatedUser } from "../http";

beforeEach(() => {
  state.session.mockReset().mockResolvedValue({ userId: "cookie-owner" });
  state.verifyToken.mockReset().mockResolvedValue({ sub: "cookie-owner" });
  state.authenticate.mockReset().mockResolvedValue({ userId: "agent-owner", tokenId: "token-id", scopes: ["portfolio:read"] });
});
describe("HTTP authorization boundary", () => {
  it.each(["Bearer invalid", "bearer invalid"])("rejects %s with valid ambient cookies before mutation", async (authorization) => {
    state.verifyToken.mockRejectedValue(new Error("invalid signature"));
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withAuthenticatedUser(handler, { request: new Request("https://pointup.test/api", { method: "POST", headers: { Authorization: authorization, Origin: "https://attacker.test" } }) });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
  });
  it("permits verified Clerk bearer without Origin only with matching Clerk authority", async () => {
    const handler = vi.fn(async (userId, principal) => NextResponse.json({ userId, kind: principal.kind }));
    const response = await withAuthenticatedUser(handler, { request: new Request("https://pointup.test/api", { method: "POST", headers: { Authorization: "Bearer clerk.jwt" } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: "cookie-owner", kind: "clerk-bearer" });
    expect(state.verifyToken).toHaveBeenCalledWith("clerk.jwt", { secretKey: process.env.CLERK_SECRET_KEY });
    state.session.mockResolvedValue({ userId: "other-owner" });
    expect((await withAuthenticatedUser(handler, { request: new Request("https://pointup.test/api", { headers: { Authorization: "Bearer clerk.jwt" } }) })).status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("returns structured private 401 and never executes on invalid token", async () => {
    state.authenticate.mockRejectedValue(new Error("secret provider payload"));
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withAuthenticatedUser(handler, { request: new Request("https://pointup.test/api", { headers: { Authorization: "Bearer pu_bad" } }), scope: "portfolio:read" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Agent token is invalid, expired, or revoked" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(handler).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
  });
  it("rejects broad-scope PAT at consent/approval boundary", async () => {
    state.authenticate.mockResolvedValue({ userId: "agent-owner", tokenId: "id", scopes: ["portfolio:write", "observations:write"] });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withBrowserAuthenticatedUser(new Request("https://pointup.test/api", { method: "POST", headers: { Authorization: "Bearer pu_token", Origin: "https://pointup.test" } }), handler);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it("blocks cookie cross-site mutation before handler runs", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withBrowserAuthenticatedUser(new Request("https://pointup.test/api", { method: "POST", headers: { Origin: "https://attacker.test" } }), handler);
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it("passes scoped token owner and retains private cache controls", async () => {
    const response = await withAuthenticatedUser(async (userId, principal) => NextResponse.json({ userId, kind: principal.kind }), { request: new Request("https://pointup.test/api", { headers: { Authorization: "Bearer pu_read" } }), scope: "portfolio:read" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: "agent-owner", kind: "agent" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
