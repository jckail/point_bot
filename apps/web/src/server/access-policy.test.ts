import { InsufficientScopeError } from "@pointup/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  authorize,
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
