import { AccessTokenId, InsufficientScopeError, UserId } from "@pointup/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RequestBodyError } from "./request-body";

import {
  assertCsrfSafe,
  authorize,
  mayWritePortfolio,
  mapError,
  rateLimitClassFor,
  rateLimitKey,
  parseAppOrigin,
  type Principal,
} from "./access-policy";

const session: Principal = { userId: UserId.parse("u1"), scopes: "session" };
const token = (scopes: Principal["scopes"]): Principal => ({
  userId: UserId.parse("u1"),
  scopes,
  tokenId: AccessTokenId.parse("t1"),
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
  it("requires browser authority even for an independently verified Clerk bearer", () => {
    const requirement = { scope: "consents:manage" as const, sessionOnly: true };
    expect(() => authorize(session, requirement)).not.toThrow();
    expect(() => authorize(token(["consents:manage"]), requirement)).toThrow(InsufficientScopeError);
    expect(() => authorize({ ...session, credential: "clerk-bearer" }, requirement)).toThrow(InsufficientScopeError);
    expect(() => authorize({ ...session, credential: "clerk-bearer" }, { scope: "portfolio:read" })).not.toThrow();
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
  it("maps only trusted bounded-body failures into transport errors", () => {
    expect(mapError(new RequestBodyError(413, "REQUEST_TOO_LARGE", "Request body exceeds 2 MiB"))).toEqual({ code: "REQUEST_TOO_LARGE", message: "Request body exceeds 2 MiB", unexpected: false });
    expect(mapError(new RequestBodyError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json"))).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", unexpected: false });
    expect(mapError(Object.assign(new Error("private upstream diagnostic"), { code: "REQUEST_TOO_LARGE", status: 413 }))).toEqual({ code: "INTERNAL", message: "Internal server error", unexpected: true });
  });
});

describe("assertCsrfSafe (cookie sessions)", () => {
  const ok = {
    principal: session,
    origin: "https://app.example.com",
    expectedOrigin: "https://app.example.com",
    method: "POST",
    contentType: "application/json",
    hasBody: true,
  };
  it("allows same-origin JSON and absent Origin on reads", () => {
    expect(() => assertCsrfSafe(ok)).not.toThrow();
    expect(() => assertCsrfSafe({ ...ok, origin: null, method: "GET" })).not.toThrow();
    expect(() =>
      assertCsrfSafe({ ...ok, contentType: "application/json; charset=utf-8" }),
    ).not.toThrow();
    expect(() =>
      assertCsrfSafe({ ...ok, origin: "https://public.example.com", expectedOrigin: "https://public.example.com" }),
    ).not.toThrow();
  });
  it("allows body-less requests without a content type", () => {
    expect(() =>
      assertCsrfSafe({ ...ok, contentType: null, hasBody: false }),
    ).not.toThrow();
  });
  it("rejects a mismatching, null, or malformed Origin", () => {
    for (const origin of ["http://app.example.com", "https://evil.example", "null", "not a url", "https://app.example.com.evil.example", "https://app.example.com/path", "https://app.example.com?query", "https://user@app.example.com"]) {
      expect(() => assertCsrfSafe({ ...ok, origin })).toThrow(/rejected/);
    }
  });
  it("rejects missing Origin on body-less cookie mutations", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => assertCsrfSafe({ ...ok, origin: null, method, contentType: null, hasBody: false })).toThrow(/Origin is required/);
    }
  });
  it("compares normalized default ports but never trusts extra forwarded headers", () => {
    expect(() => assertCsrfSafe({ ...ok, origin: "https://app.example.com:443" })).not.toThrow();
    const spoofed = { ...ok, origin: "https://evil.example", forwardedHost: "evil.example" };
    expect(() => assertCsrfSafe(spoofed)).toThrow(/app origin/);
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
    expect(() => assertCsrfSafe({ ...ok, principal: { ...session, credential: "clerk-bearer" }, origin: null, contentType: null })).not.toThrow();
  });
});

describe("canonical app origin configuration", () => {
  it.each([
    ["http://localhost:3000/", "http://localhost:3000"],
    ["https://app.example.com:443", "https://app.example.com"],
    ["http://app.example.com:80", "http://app.example.com"],
  ])("normalizes explicit origin %s", (input, expected) => {
    expect(parseAppOrigin(input)).toBe(expected);
  });
  it.each(["invalid", "ftp://app.example.com", "https://user:secret@app.example.com", "https://app.example.com/path", "https://app.example.com/path/..", "https://app.example.com?", "https://app.example.com#", "https://app.example.com?key=secret", "https://app.example.com#secret"])("rejects non-origin configuration safely", input => {
    expect(() => parseAppOrigin(input)).toThrow("APP_URL must be an HTTP or HTTPS origin");
    try { parseAppOrigin(input); } catch (error) { expect(String(error)).not.toContain(input); }
  });
});

describe("mayWritePortfolio", () => {
  it("is true for sessions and portfolio:write tokens only", () => {
    expect(mayWritePortfolio(session)).toBe(true);
    expect(mayWritePortfolio(token(["portfolio:write"]))).toBe(true);
    expect(mayWritePortfolio(token(["observations:write", "consents:manage"]))).toBe(false);
  });
});
