import { UserId, type SpanHandle } from "@pointup/core";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransaction, OPENAI_ISSUER, TRANSACTION_COOKIE } from "@/server/chatgpt/oidc";

const state = vi.hoisted(() => ({
  headers: new Headers(), auth: vi.fn(), verifyToken: vi.fn(), authenticate: vi.fn(),
  config: vi.fn(), consume: vi.fn(), discovery: vi.fn(), verify: vi.fn(), link: vi.fn(),
  consumeLimit: vi.fn(), log: vi.fn(), counter: vi.fn(), histogram: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/dist/server/app-render/work-async-storage.external", () => ({ workAsyncStorage: { getStore: () => ({ route: "/api/auth/chatgpt/callback/route" }) } }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.auth, verifyToken: state.verifyToken }));
vi.mock("@/env", () => ({ env: { AUTH_PROVIDER: "clerk", NODE_ENV: "production", APP_URL: "https://pointup.test", CLERK_SECRET_KEY: "synthetic-config-key" } }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { authenticateAccessToken: { execute: state.authenticate } } }) }));
vi.mock("@/server/chatgpt/config", () => ({ chatGptConfig: state.config }));
vi.mock("@/server/chatgpt/storage", () => ({ consumeTransaction: state.consume, linkIdentity: state.link }));
vi.mock("@/server/chatgpt/oidc", async original => ({ ...await original<object>(), discoverOpenAi: state.discovery, verifyIdentity: state.verify }));
vi.mock("@/server/rate-limit", () => ({ getRateLimiter: () => ({ consume: state.consumeLimit }) }));
vi.mock("@/server/observability", () => ({ webObservability: () => ({
  logger: { info: state.log, warn: state.log, error: state.log },
  metrics: { counter: state.counter, histogram: state.histogram },
  tracer: { withSpan: async (_name: string, _attributes: unknown, fn: (span: SpanHandle) => Promise<unknown>) => await fn({ setAttribute() {}, setAttributes() {} }) },
}) }));

// The real shared wrapper, access policy and credential-selection seam execute.
import { withAuthenticatedUser } from "@/server/http";
import { GET } from "./route";
const config = { clientId: "oaiapp_synthetic", redirectUri: "https://pointup.test/api/auth/chatgpt/callback", authenticationMethod: "none" };
const discovery = { issuer: OPENAI_ISSUER, authorization_endpoint: `${OPENAI_ISSUER}/api/accounts/authorize`, token_endpoint: `${OPENAI_ISSUER}/api/accounts/oauth/token`, jwks_uri: `${OPENAI_ISSUER}/.well-known/jwks.json` };
function navigation() {
  const transaction = createTransaction(UserId.parse("synthetic-owner"), config.redirectUri);
  state.consume.mockResolvedValue(transaction);
  const request = new NextRequest(`${config.redirectUri}?state=${transaction.state}&code=PRIVATE_CODE`, { headers: state.headers });
  return { request, transaction };
}
beforeEach(() => {
  vi.resetAllMocks();
  state.headers = new Headers({ host: "pointup.test", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", cookie: `${TRANSACTION_COOKIE}=${"b".repeat(43)}` });
  state.auth.mockResolvedValue({ userId: "synthetic-owner" });
  state.config.mockReturnValue(config);
  state.discovery.mockResolvedValue(discovery);
  state.verify.mockResolvedValue({ issuer: OPENAI_ISSUER, clientId: config.clientId, subject: "synthetic-subject" });
  state.link.mockResolvedValue(undefined);
  state.consumeLimit.mockResolvedValue({ allowed: true, limit: 120, remaining: 119 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_token: "PRIVATE_ID_TOKEN" })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("ChatGPT callback through the real HTTP boundary", () => {
  it("lets a provider top-level navigation reach owner/state/PKCE verification and preserves telemetry", async () => {
    const { request, transaction } = navigation();
    const response = await GET(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://pointup.test/dashboard/settings?chatgpt=linked");
    expect(state.consume).toHaveBeenCalledWith("b".repeat(43));
    expect(state.verify).toHaveBeenCalledWith("PRIVATE_ID_TOKEN", transaction.nonce, config.clientId, discovery);
    expect(state.link).toHaveBeenCalledWith(expect.objectContaining({ subject: "synthetic-subject" }), "synthetic-owner");
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).get("code_verifier")).toBe(transaction.codeVerifier);
    expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(state.consumeLimit).toHaveBeenCalled();
    expect(state.counter).toHaveBeenCalled();
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/PRIVATE_|codeVerifier|synthetic-owner/);
  });

  it("does not extend the cross-site exception to an ordinary authenticated GET", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withAuthenticatedUser(handler, { method: "GET", scope: "portfolio:read", sessionOnly: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CSRF_REJECTED" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["Bearer pu_synthetic", "Bearer clerk-synthetic", "Basic ignored", ""])("never borrows cookies for explicit credentials %j", async authorization => {
    state.headers.set("authorization", authorization);
    const response = await GET(navigation().request);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "INSUFFICIENT_SCOPE" } });
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
    expect(state.authenticate).not.toHaveBeenCalled();
    expect(state.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ key: "sec-fetch-mode", value: "cors" }, { key: "sec-fetch-dest", value: "iframe" }, { key: "origin", value: "https://auth.openai.com" }, { key: "content-length", value: "1" }])("rejects a callback outside the bodyless navigation envelope: %j", async ({ key, value }) => {
    state.headers.set(key, value);
    const response = await GET(navigation().request);
    expect(response.status).toBe(403);
    expect(state.consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still rejects invalid state after allowing the provider navigation", async () => {
    const { request } = navigation();
    request.nextUrl.searchParams.set("state", "invalid-state");
    const response = await GET(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("chatgpt=error");
    expect(state.consume).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.link).not.toHaveBeenCalled();
  });
});
