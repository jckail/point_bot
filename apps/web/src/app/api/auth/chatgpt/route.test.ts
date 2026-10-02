import { UserId } from "@pointup/core";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransaction, OPENAI_ISSUER, TRANSACTION_COOKIE, type SignInTransaction } from "@/server/chatgpt/oidc";

type AuthFixture = { userId: UserId | null; authorization: boolean };
const state = vi.hoisted(() => {
  const auth: AuthFixture = { userId: null, authorization: false };
  const options: unknown[] = [];
  return { auth, config: vi.fn(), discover: vi.fn(), linked: vi.fn(), save: vi.fn(), consume: vi.fn(), link: vi.fn(), verify: vi.fn(), log: vi.fn(), options };
});
vi.mock("@/server/chatgpt/config", () => ({ chatGptConfig: state.config }));
vi.mock("@/server/chatgpt/storage", () => ({ linkedIdentity: state.linked, saveTransaction: state.save, consumeTransaction: state.consume, linkIdentity: state.link }));
vi.mock("@/server/observability", () => ({ webObservability: () => ({ logger: { warn: state.log } }) }));
vi.mock("@/server/chatgpt/oidc", async original => ({ ...await original<object>(), discoverOpenAi: state.discover, verifyIdentity: state.verify }));
vi.mock("@/server/http", () => ({ withAuthenticatedUser: async (handler: (userId: UserId) => Promise<NextResponse>, options: { sessionOnly: boolean }) => {
  state.options.push(options);
  const response = state.auth.authorization && options.sessionOnly
    ? NextResponse.json({ error: "Cookie session required" }, { status: 403 })
    : state.auth.userId ? await handler(state.auth.userId) : NextResponse.json({ error: "Sign in required" }, { status: 401 });
  response.headers.set("x-request-id", "safe-support-reference");
  return response;
} }));

import { GET, POST } from "./route";
import { GET as callback } from "./callback/route";
const config = { clientId: "oaiapp_synthetic", redirectUri: "https://pointup.test/api/auth/chatgpt/callback", authenticationMethod: "none" };
const discovery = { issuer: OPENAI_ISSUER, authorization_endpoint: `${OPENAI_ISSUER}/api/accounts/authorize`, token_endpoint: `${OPENAI_ISSUER}/api/accounts/oauth/token`, jwks_uri: `${OPENAI_ISSUER}/.well-known/jwks.json` };
function start(origin = "https://pointup.test") {
  return new NextRequest("https://pointup.test/api/auth/chatgpt", { method: "POST", headers: { origin } });
}
function callbackRequest(transaction: SignInTransaction, suffix = "") {
  return new NextRequest(`${config.redirectUri}?state=${transaction.state}&code=PRIVATE_CODE${suffix}`, { headers: { cookie: `${TRANSACTION_COOKIE}=${"b".repeat(43)}` } });
}
beforeEach(() => {
  vi.resetAllMocks();
  state.options.length = 0;
  state.auth.userId = UserId.parse("synthetic-owner");
  state.auth.authorization = false;
  state.config.mockReturnValue(config);
  state.discover.mockResolvedValue(discovery);
  state.linked.mockResolvedValue(false);
  state.save.mockResolvedValue(undefined);
  state.link.mockResolvedValue(undefined);
  state.verify.mockResolvedValue({ issuer: OPENAI_ISSUER, clientId: config.clientId, subject: "PRIVATE_SUBJECT" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_token: "PRIVATE_ID_TOKEN", access_token: "PRIVATE_ACCESS_TOKEN" })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("browser-only ChatGPT linking routes", () => {
  it.each(["bearer", "signed-out"])("rejects %s authority before discovery or storage", async kind => {
    state.auth.authorization = kind === "bearer";
    if (kind === "signed-out") state.auth.userId = null;
    const expectedStatus = kind === "bearer" ? 403 : 401;
    expect((await GET()).status).toBe(expectedStatus);
    expect((await POST(start())).status).toBe(expectedStatus);
    const transaction = createTransaction(UserId.parse("synthetic-owner"), config.redirectUri);
    const response = await callback(callbackRequest(transaction));
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(state.options).toEqual([
      { method: "GET", scope: "portfolio:read", sessionOnly: true },
      { method: "POST", scope: "portfolio:read", sessionOnly: true },
      { method: "GET", scope: "portfolio:read", sessionOnly: true, oauthCallback: "chatgpt" },
    ]);
    expect(state.config).not.toHaveBeenCalled();
    expect(state.discover).not.toHaveBeenCalled();
    expect(state.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports linking mode and stays disabled without client configuration", async () => {
    state.config.mockReturnValue(null);
    const response = await GET();
    expect(await response.json()).toEqual({ configured: false, linked: false, mode: "account-linking" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(start())).status).toBe(503);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("requires the registered origin and stores a server-owned PKCE transaction", async () => {
    expect((await POST(start("https://foreign.test"))).status).toBe(403);
    expect(state.discover).not.toHaveBeenCalled();
    const response = await POST(start());
    expect(response.status).toBe(303);
    expect(state.save).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expect.objectContaining({ userId: "synthetic-owner", redirectUri: config.redirectUri }));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(OPENAI_ISSUER);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.has("code_verifier")).toBe(false);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain("codeVerifier");
    expect(response.headers.get("x-request-id")).toBe("safe-support-reference");
  });
  it.each(["expired", "changed-owner", "replayed", "ambiguous"])("rejects %s callbacks before any token exchange", async kind => {
    const transaction = createTransaction(UserId.parse("synthetic-owner"), config.redirectUri);
    if (kind === "expired") transaction.expiresAt = Date.now() - 1;
    if (kind === "changed-owner") transaction.userId = UserId.parse("other-owner");
    state.consume.mockResolvedValue(kind === "replayed" ? null : transaction);
    const response = await callback(callbackRequest(transaction, kind === "ambiguous" ? "&code=duplicate" : ""));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://pointup.test/dashboard/settings?chatgpt=error");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetch).not.toHaveBeenCalled();
    expect(state.link).not.toHaveBeenCalled();
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/PRIVATE_|other-owner|synthetic-owner/);
  });
  it("links only a verified identity to the persisted owner and never stores tokens", async () => {
    const transaction = createTransaction(UserId.parse("synthetic-owner"), config.redirectUri);
    state.consume.mockResolvedValue(transaction);
    const response = await callback(callbackRequest(transaction));
    expect(state.verify).toHaveBeenCalledWith("PRIVATE_ID_TOKEN", transaction.nonce, config.clientId, discovery);
    expect(state.link).toHaveBeenCalledWith({ issuer: OPENAI_ISSUER, clientId: config.clientId, subject: "PRIVATE_SUBJECT" }, "synthetic-owner");
    expect(JSON.stringify(state.link.mock.calls)).not.toMatch(/PRIVATE_ID_TOKEN|PRIVATE_ACCESS_TOKEN|PRIVATE_CODE/);
    expect(response.headers.get("location")).toBe("https://pointup.test/dashboard/settings?chatgpt=linked");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("keeps provider and DB failures private with bounded stage diagnostics", async () => {
    const transaction = createTransaction(UserId.parse("synthetic-owner"), config.redirectUri);
    state.consume.mockResolvedValue(transaction);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("PRIVATE_PROVIDER_BODY", { status: 400, headers: { "x-request-id": "invalid ID PRIVATE_DATA" } }));
    const response = await callback(callbackRequest(transaction));
    expect(response.headers.get("location")).toContain("chatgpt=error");
    expect(state.verify).not.toHaveBeenCalled();
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/PRIVATE_|codeVerifier|nonce/);
    state.consume.mockRejectedValueOnce(new Error("PRIVATE_SQL_BODY"));
    await callback(callbackRequest(transaction));
    expect(JSON.stringify(state.log.mock.calls)).not.toContain("PRIVATE_SQL_BODY");
  });
});
