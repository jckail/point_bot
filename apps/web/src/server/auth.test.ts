import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessTokenInvalidError, InsufficientScopeError, UserId } from "@pointup/core";

const state = vi.hoisted(() => ({
  headers: new Headers(), auth: vi.fn(), verifyToken: vi.fn(),
  env: { AUTH_PROVIDER: "clerk", DEV_USER_ID: "dev-user", DEV_AUTH_ALLOWED_HOSTS: undefined as string | undefined, CLERK_SECRET_KEY: "test-config-key" },
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.auth, verifyToken: state.verifyToken }));

import { getSessionUserId, resolveRequestPrincipal } from "./auth";

beforeEach(() => {
  vi.resetAllMocks();
  state.env.AUTH_PROVIDER = "clerk";
  state.env.DEV_AUTH_ALLOWED_HOSTS = undefined;
  state.headers = new Headers({ host: "localhost:3000" });
  state.auth.mockResolvedValue({ userId: "user-one" });
  state.verifyToken.mockResolvedValue({ sub: "user-one" });
});

describe("request credential selection", () => {
  it("uses the Clerk session only when Authorization is absent", async () => {
    const authenticate = vi.fn();
    expect(await resolveRequestPrincipal({}, authenticate)).toEqual({ userId: UserId.parse("user-one"), scopes: "session" });
    expect(authenticate).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
    state.auth.mockResolvedValueOnce({ userId: null });
    expect(await resolveRequestPrincipal({}, authenticate)).toBeNull();
  });
  it.each(["", "Basic opaque", "Bearer", "Bearer token extra", "Bearer one,two"])("rejects malformed %j without resolving ambient cookies", async header => {
    state.headers.set("authorization", header);
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toBeInstanceOf(AccessTokenInvalidError);
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
  });
  it("authenticates a PAT once without Clerk fallback, preserving its scope principal", async () => {
    state.headers.set("authorization", "bearer pu_example");
    const principal = { userId: UserId.parse("pat-owner"), scopes: [] };
    const authenticate = vi.fn().mockResolvedValue(principal);
    expect(await resolveRequestPrincipal({}, authenticate)).toBe(principal);
    expect(authenticate).toHaveBeenCalledWith("pu_example");
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
  });
  it("never retries a rejected PAT as Clerk or cookie authority", async () => {
    state.headers.set("authorization", "Bearer pu_invalid");
    const authenticate = vi.fn().mockRejectedValue(new AccessTokenInvalidError());
    await expect(resolveRequestPrincipal({}, authenticate)).rejects.toBeInstanceOf(AccessTokenInvalidError);
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
  });
  it("independently verifies the exact Clerk JWT and requires session subject agreement", async () => {
    state.headers.set("authorization", "Bearer signed-jwt");
    expect(await resolveRequestPrincipal({}, vi.fn())).toEqual({ userId: UserId.parse("user-one"), scopes: "session", credential: "clerk-bearer" });
    expect(state.verifyToken).toHaveBeenCalledWith("signed-jwt", { secretKey: "test-config-key" });
    state.auth.mockResolvedValueOnce({ userId: "user-two" });
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toBeInstanceOf(AccessTokenInvalidError);
    state.auth.mockResolvedValueOnce({ userId: null });
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });
  it("rejects invalid JWTs before reading cookies and hides verifier diagnostics", async () => {
    state.headers.set("authorization", "Bearer invalid-jwt");
    state.verifyToken.mockRejectedValueOnce(new Error("private upstream credential diagnostic"));
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toThrow("Access token is invalid, expired, or revoked");
    expect(state.auth).not.toHaveBeenCalled();
    state.verifyToken.mockResolvedValueOnce({ sub: "" });
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toBeInstanceOf(AccessTokenInvalidError);
    expect(state.auth).not.toHaveBeenCalled();
  });
  it.each(["Bearer signed-jwt", "Bearer pu_example", "Basic invalid", ""])("rejects any Authorization on browser-only actions: %j", async header => {
    state.headers.set("authorization", header);
    const authenticate = vi.fn();
    await expect(resolveRequestPrincipal({ sessionOnly: true }, authenticate)).rejects.toBeInstanceOf(InsufficientScopeError);
    expect(authenticate).not.toHaveBeenCalled();
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.verifyToken).not.toHaveBeenCalled();
  });
  it("preserves loopback dev sessions and rejects untrusted hosts without loading Clerk", async () => {
    state.env.AUTH_PROVIDER = "dev";
    expect(await getSessionUserId()).toBe(UserId.parse("dev-user"));
    expect(await resolveRequestPrincipal({ sessionOnly: true }, vi.fn())).toEqual({ userId: UserId.parse("dev-user"), scopes: "session" });
    state.headers.set("host", "untrusted.example");
    expect(await resolveRequestPrincipal({}, vi.fn())).toBeNull();
    expect(state.auth).not.toHaveBeenCalled();
  });
  it("rejects non-PAT bearers in dev mode instead of assuming the seeded identity", async () => {
    state.env.AUTH_PROVIDER = "dev";
    state.headers.set("authorization", "Bearer invalid-jwt");
    await expect(resolveRequestPrincipal({}, vi.fn())).rejects.toBeInstanceOf(AccessTokenInvalidError);
    expect(state.verifyToken).not.toHaveBeenCalled();
    expect(state.auth).not.toHaveBeenCalled();
  });
});
