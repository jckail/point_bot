import { describe, expect, it, vi } from "vitest";
import { checkBrowserMutation, HttpAuthError, resolvePrincipal, type AuthPrincipal, type CredentialResolvers } from "./auth";

function resolvers(scopes: readonly ("portfolio:read" | "observations:write")[] = ["portfolio:read"]): CredentialResolvers {
  return { session: vi.fn(async () => ({ userId: "cookie-owner" })), clerkBearer: vi.fn(async () => ({ userId: "cookie-owner" })), agent: vi.fn(async () => ({ userId: "token-owner", tokenId: "token-id", scopes })) };
}

describe("credential selection and scopes", () => {
  it("selects PAT authority independently of an existing cookie", async () => {
    const handlers = resolvers();
    expect(await resolvePrincipal({ authorization: "Bearer pu_valid", scope: "portfolio:read" }, handlers)).toMatchObject({ kind: "agent", userId: "token-owner" });
    expect(handlers.session).not.toHaveBeenCalled();
  });
  it.each(["invalid", "expired", "revoked"])("fails closed for %s PAT despite a valid cookie", async () => {
    const handlers = resolvers();
    handlers.agent = vi.fn(async () => { throw new Error("private token/database details"); });
    await expect(resolvePrincipal({ authorization: "Bearer pu_bad", scope: "portfolio:read" }, handlers)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED", message: "Agent token is invalid, expired, or revoked" });
    expect(handlers.session).not.toHaveBeenCalled();
  });
  it("rejects a missing mutation scope rather than treating read permission as write", async () => {
    const handlers = resolvers();
    await expect(resolvePrincipal({ authorization: "Bearer pu_read", scope: "observations:write" }, handlers)).rejects.toMatchObject({ status: 403 });
    await expect(resolvePrincipal({ authorization: "Bearer pu_read" }, handlers)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves Clerk bearer sessions and browser cookies", async () => {
    const handlers = resolvers();
    expect(await resolvePrincipal({ authorization: "Bearer clerk.jwt" }, handlers)).toMatchObject({ kind: "clerk-bearer", userId: "cookie-owner" });
    expect(await resolvePrincipal({ authorization: null }, handlers)).toMatchObject({ kind: "session" });
    expect(handlers.agent).not.toHaveBeenCalled();
  });
  it.each(["Bearer invalid", "bearer invalid"])("never falls back to a cookie for unverified %s", async (authorization) => {
    const handlers = resolvers();
    handlers.clerkBearer = vi.fn(async () => { throw new Error("private verifier details"); });
    await expect(resolvePrincipal({ authorization }, handlers)).rejects.toMatchObject({ status: 401, message: "Clerk bearer credential is invalid" });
    expect(handlers.session).not.toHaveBeenCalled();
  });
  it.each([null, "other-owner"])("rejects verified bearer when Clerk's current authority is %s", async (userId) => {
    const handlers = resolvers();
    handlers.session = vi.fn(async () => ({ userId }));
    await expect(resolvePrincipal({ authorization: "Bearer clerk.jwt" }, handlers)).rejects.toMatchObject({ status: 401 });
  });
  it.each(["Bearer pu_valid", "Bearer clerk.jwt", "Basic credential"])("prevents %s from acquiring management/approval authority", async (authorization) => {
    const handlers = resolvers(["observations:write"]);
    await expect(resolvePrincipal({ authorization, browserOnly: true }, handlers)).rejects.toMatchObject({ status: 403 });
    expect(handlers.session).not.toHaveBeenCalled();
    expect(handlers.agent).not.toHaveBeenCalled();
  });
  it.each(["Bearer", "Bearer pu_one,pu_two", "Basic pu_token", "Bearer pu_token extra"])("rejects malformed authorization %s", async (authorization) => {
    const handlers = resolvers();
    await expect(resolvePrincipal({ authorization, scope: "portfolio:read" }, handlers)).rejects.toMatchObject({ status: 401 });
    expect(handlers.session).not.toHaveBeenCalled();
  });
  it("does not pass agent validation errors through to clients", async () => {
    const handlers = resolvers();
    handlers.agent = async () => { throw new Error("postgres secret details"); };
    await expect(resolvePrincipal({ authorization: "Bearer PU_bad", scope: "portfolio:read" }, handlers)).rejects.toBeInstanceOf(HttpAuthError);
    expect(handlers.session).not.toHaveBeenCalled();
  });
});

describe("cookie mutation CSRF protection", () => {
  const session: AuthPrincipal = { kind: "session", userId: "cookie-owner", scopes: [] };
  it("permits same-origin browser mutation and read", () => {
    expect(() => checkBrowserMutation(new Request("https://pointup.test/api", { method: "POST", headers: { Origin: "https://pointup.test", "Sec-Fetch-Site": "same-origin" } }), session)).not.toThrow();
    expect(() => checkBrowserMutation(new Request("https://pointup.test/api"), session)).not.toThrow();
  });
  it.each([{}, { Origin: "https://attacker.test" }, { Origin: "null" }, { Origin: "https://pointup.test", "Sec-Fetch-Site": "cross-site" }])("rejects unsafe ambient cookie request headers %o", (headers) => {
    expect(() => checkBrowserMutation(new Request("https://pointup.test/api", { method: "POST", headers: headers as HeadersInit }), session)).toThrow(HttpAuthError);
  });
  it("does not require browser Origin for explicitly authenticated agents/Clerk clients", () => {
    const request = new Request("https://pointup.test/api", { method: "POST", headers: { Authorization: "Bearer token" } });
    expect(() => checkBrowserMutation(request, session)).toThrow(HttpAuthError);
    expect(() => checkBrowserMutation(request, { kind: "clerk-bearer", userId: "cookie-owner", scopes: [] })).not.toThrow();
    expect(() => checkBrowserMutation(request, { kind: "agent", userId: "agent-owner", tokenId: "id", scopes: ["observations:write"] })).not.toThrow();
  });
});
