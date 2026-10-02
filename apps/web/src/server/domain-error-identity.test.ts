import { afterEach, describe, expect, it, vi } from "vitest";

const hidden = { code: "INTERNAL", message: "Internal server error", unexpected: true };
afterEach(() => { vi.resetModules(); });

describe("cross-module domain error identity", () => {
  it("maps invalid credentials from a retained real traced authenticator after the core module is reevaluated", async () => {
    const previous = await import("@pointup/core");
    const tokens = {
      findById: vi.fn().mockResolvedValue(null), findByHash: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn(),
    };
    // Same lifetime as globalForContainer.container: retain the old use case
    // and its genuine observability proxy while route modules are reevaluated.
    const cached = previous.traced("authenticateAccessToken", new previous.AuthenticateAccessToken(tokens));
    vi.resetModules();
    const current = await import("@pointup/core");
    const { mapError } = await import("./access-policy");
    expect(previous.DomainError).not.toBe(current.DomainError);
    let rejected: unknown;
    try { await cached.execute("pu_SYNTHETIC_INVALID_DISPLAY_PREFIX"); } catch (error) { rejected = error; }
    expect(rejected).toBeInstanceOf(previous.AccessTokenInvalidError);
    expect(rejected).not.toBeInstanceOf(current.DomainError);
    const mapped = mapError(rejected);
    expect(mapped).toEqual({ code: "UNAUTHENTICATED", message: "Access token is invalid, expired, or revoked", unexpected: false });
    const { httpStatusForErrorCode } = await import("@pointup/core/contracts");
    expect(httpStatusForErrorCode(mapped.code)).toBe(401);
    expect(current.isDomainError(rejected)).toBe(true);
    expect(tokens.findByHash).toHaveBeenCalledOnce();
  });

  it("preserves genuine earlier scope errors as403 without changing their object identity", async () => {
    const previous = await import("@pointup/core");
    const error = new previous.InsufficientScopeError("portfolio:write");
    vi.resetModules();
    const current = await import("@pointup/core");
    const { mapError } = await import("./access-policy");
    const { httpStatusForErrorCode } = await import("@pointup/core/contracts");
    expect(error).not.toBeInstanceOf(current.DomainError);
    expect(mapError(error)).toEqual({ code: "INSUFFICIENT_SCOPE", message: error.message, unexpected: false });
    expect(httpStatusForErrorCode(mapError(error).code)).toBe(403);
    expect(error).toBeInstanceOf(previous.InsufficientScopeError);
  });

  it("rejects copied JSON, native errors and forged domain prototypes without exporting their messages", async () => {
    const { DomainError, isDomainError } = await import("@pointup/core");
    const { mapError } = await import("./access-policy");
    for (const forged of [
      { name: "AccessTokenInvalidError", code: "UNAUTHENTICATED", message: "SYNTHETIC_PRIVATE_JSON" },
      Object.assign(new Error("SYNTHETIC_PRIVATE_NATIVE"), { code: "UNAUTHENTICATED" }),
      Object.assign(Object.create(DomainError.prototype), { code: "UNAUTHENTICATED", message: "SYNTHETIC_PRIVATE_PROTOTYPE" }),
    ]) {
      expect(mapError(forged)).toEqual(hidden);
      expect(isDomainError(forged)).toBe(false);
    }
    const code = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_GETTER"); });
    const forged = Object.defineProperty({}, "code", { get: code });
    expect(mapError(forged)).toEqual(hidden);
    expect(code).not.toHaveBeenCalled();
  });

  it("hides malformed registered code/message properties and never treats transport codes as domain errors", async () => {
    const { AccessTokenInvalidError } = await import("@pointup/core");
    const { mapError } = await import("./access-policy");
    for (const code of ["INTERNAL", "RATE_LIMITED", "UNREGISTERED_PRIVATE_CODE"]) {
      const error = new AccessTokenInvalidError();
      Object.defineProperty(error, "code", { value: code });
      expect(mapError(error)).toEqual(hidden);
    }
    for (const field of ["code", "message"]) {
      const error = new AccessTokenInvalidError();
      Object.defineProperty(error, field, { get() { throw new Error("SYNTHETIC_PRIVATE_GETTER"); } });
      expect(mapError(error)).toEqual(hidden);
    }
  });
});
