import { InsufficientScopeError } from "@pointup/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertCsrfSafe,
  authorize,
  mayWritePortfolio,
  mapError,
  rateLimitClassFor,
  rateLimitKey,
  type Principal,
} from "./access-policy";

const session: Principal = { userId: "u1", scopes: "session" };
const token = (scopes: Principal["scopes"]): Principal => ({
  userId: "u1",
  scopes,
  tokenId: "t1",
});

describe("authorize", () => {
  it("trusts sessions for every scope", () => {
    expect(() => authorize(session, { scope: "portfolio:write" })).not.toThrow();
  });
  it("requires the scope on tokens", () => {
    expect(() =>
      authorize(token(["portfolio:read"]), { scope: "portfolio:write" }),
    ).toThrow(InsufficientScopeError);
    expect(() =>
      authorize(token(["portfolio:read"]), { scope: "portfolio:read" }),
    ).not.toThrow();
  });
  it("rejects tokens on session-only routes", () => {
    expect(() =>
      authorize(token(["consents:manage"]), {
        scope: "consents:manage",
        sessionOnly: true,
      }),
    ).toThrow(InsufficientScopeError);
    expect(() =>
      authorize(session, { scope: "consents:manage", sessionOnly: true }),
    ).not.toThrow();
  });
});

describe("rate limit selection", () => {
  it("keys by token id, else user id", () => {
    expect(rateLimitKey(token(["portfolio:read"]), "default")).toBe(
      "default:token:t1",
    );
    expect(rateLimitKey(session, "default")).toBe("default:user:u1");
  });
  it("uses the strict class for token writes only", () => {
    const req = { scope: "portfolio:write" as const };
    expect(rateLimitClassFor(token(["portfolio:write"]), req)).toBe("write");
    expect(rateLimitClassFor(session, req)).toBe("default");
    expect(
      rateLimitClassFor(token(["portfolio:read"]), { scope: "portfolio:read" }),
    ).toBe("default");
    expect(
      rateLimitClassFor(session, { ...req, rateLimit: "observations" }),
    ).toBe("observations");
  });
});

describe("mapError", () => {
  it("maps zod errors to INVALID_REQUEST", () => {
    const r = z.object({ a: z.string() }).safeParse({});
    expect(r.success).toBe(false);
    const mapped = mapError(r.error);
    expect(mapped).toMatchObject({ code: "INVALID_REQUEST", unexpected: false });
  });
  it("maps domain errors by code", () => {
    expect(mapError(new InsufficientScopeError("portfolio:write"))).toMatchObject(
      { code: "INSUFFICIENT_SCOPE", unexpected: false },
    );
  });
  it("hides unknown errors", () => {
    expect(mapError(new Error("secret"))).toEqual({
      code: "INTERNAL",
      message: "Internal server error",
      unexpected: true,
    });
  });
});

describe("assertCsrfSafe (cookie sessions)", () => {
  const ok = {
    principal: session,
    origin: "https://app.example.com",
    host: "app.example.com",
    contentType: "application/json",
    hasBody: true,
  };
  it("allows same-origin JSON and absent Origin", () => {
    expect(() => assertCsrfSafe(ok)).not.toThrow();
    expect(() => assertCsrfSafe({ ...ok, origin: null })).not.toThrow();
    expect(() =>
      assertCsrfSafe({ ...ok, contentType: "application/json; charset=utf-8" }),
    ).not.toThrow();
    expect(() =>
      assertCsrfSafe({ ...ok, origin: "https://public.example.com", host: "internal", forwardedHost: "public.example.com" }),
    ).not.toThrow();
  });
  it("allows body-less requests without a content type", () => {
    expect(() =>
      assertCsrfSafe({ ...ok, contentType: null, hasBody: false }),
    ).not.toThrow();
  });
  it("rejects a mismatching, null, or malformed Origin", () => {
    for (const origin of ["https://evil.example", "null", "not a url", "https://app.example.com.evil.example"]) {
      expect(() => assertCsrfSafe({ ...ok, origin })).toThrow(/rejected/);
    }
  });
  it("rejects cross-site fetch metadata", () => {
    expect(() => assertCsrfSafe({ ...ok, secFetchSite: "cross-site" })).toThrow();
    expect(() => assertCsrfSafe({ ...ok, secFetchSite: "same-origin" })).not.toThrow();
  });
  it("requires application/json when there is a body", () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", null]) {
      expect(() => assertCsrfSafe({ ...ok, contentType })).toThrow(/Content-Type/);
    }
  });
  it("exempts bearer tokens", () => {
    expect(() =>
      assertCsrfSafe({ ...ok, principal: token(["portfolio:read"]), origin: "https://evil.example", contentType: "text/plain" }),
    ).not.toThrow();
  });
});

describe("mayWritePortfolio", () => {
  it("is true for sessions and portfolio:write tokens only", () => {
    expect(mayWritePortfolio(session)).toBe(true);
    expect(mayWritePortfolio(token(["portfolio:write"]))).toBe(true);
    expect(mayWritePortfolio(token(["observations:write", "consents:manage"]))).toBe(false);
  });
});
