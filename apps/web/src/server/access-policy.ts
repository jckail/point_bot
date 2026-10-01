import { type AccessTokenId, type AccessTokenScope, CsrfRejectedError, DomainError, type ErrorCode, InsufficientScopeError, type RateLimitPolicy, requireScope, type UserId } from "@pointup/core";
import { z, ZodError } from "zod";

/**
 * Framework-free auth/scope/rate-limit/error-mapping logic used by
 * `http.ts`. Kept free of Next/Clerk imports so it is unit-testable.
 */

export type Scopes = readonly AccessTokenScope[] | "session";

export interface Principal {
  readonly userId: UserId;
  readonly scopes: Scopes;
  /** Present for personal access tokens; absent for browser sessions. */
  readonly tokenId?: AccessTokenId;
}

export const RATE_LIMIT_CLASSES = ["default", "write", "observations"] as const;
export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

export interface AccessRequirement {
  readonly scope: AccessTokenScope;
  readonly sessionOnly?: boolean;
  /** Override the limit class (derived from the scope when omitted). */
  readonly rateLimit?: RateLimitClass;
}

export const RATE_LIMIT_POLICIES = {
  default: { limit: 120, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  observations: { limit: 10, windowMs: 60_000 },
} satisfies Record<RateLimitClass, RateLimitPolicy>;

const WRITE_SCOPES: ReadonlySet<AccessTokenScope> = new Set([
  "portfolio:write",
  "observations:write",
  "consents:manage",
]);

/** Throws InsufficientScopeError unless the principal may use the route. */
export function authorize(
  principal: Principal,
  requirement: AccessRequirement,
): void {
  if (requirement.sessionOnly && principal.scopes !== "session") {
    throw new InsufficientScopeError("session");
  }
  requireScope(principal.scopes, requirement.scope);
}

/** Whether the principal may create/link accounts (portfolio:write or session). */
export function mayWritePortfolio(principal: Principal): boolean {
  return (
    principal.scopes === "session" ||
    principal.scopes.includes("portfolio:write")
  );
}

export interface CsrfInput {
  readonly principal: Principal;
  readonly origin: string | null;
  readonly host: string | null;
  readonly forwardedHost?: string | null;
  readonly secFetchSite?: string | null;
  readonly contentType: string | null;
  /** True when the request carries a body (content-length > 0 or chunked). */
  readonly hasBody: boolean;
}

/**
 * CSRF defence for cookie-session principals (bearer tokens are exempt: the
 * Authorization header cannot be set by a cross-site form). Applied to every
 * method: browsers omit Origin on same-origin GETs, so legitimate reads pass,
 * while a cross-origin request carrying the cookie is refused.
 *  - A present Origin must match the request host (`null` never matches).
 *  - Request bodies must be application/json, which a plain cross-site form
 *    cannot send without a CORS preflight.
 */
export function assertCsrfSafe(input: CsrfInput): void {
  if (input.principal.scopes !== "session") return;
  if (input.secFetchSite === "cross-site") {
    throw new CsrfRejectedError("cross-site request");
  }
  if (input.origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(input.origin).host;
    } catch {
      throw new CsrfRejectedError("invalid Origin header");
    }
    const allowed = [input.host, input.forwardedHost].filter(
      (h): h is string => !!h,
    );
    if (!allowed.includes(originHost)) {
      throw new CsrfRejectedError("Origin does not match the request host");
    }
  }
  if (input.hasBody) {
    const type = input.contentType?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      throw new CsrfRejectedError("Content-Type must be application/json");
    }
  }
}

/** Limiter key: token id for tokens, user id for sessions. */
export function rateLimitKey(
  principal: Principal,
  cls: RateLimitClass,
): string {
  const who = principal.tokenId
    ? `token:${principal.tokenId}`
    : `user:${principal.userId}`;
  return `${cls}:${who}`;
}

export function rateLimitClassFor(
  principal: Principal,
  requirement: AccessRequirement,
): RateLimitClass {
  if (requirement.rateLimit) return requirement.rateLimit;
  const tokenWrite =
    principal.tokenId !== undefined && WRITE_SCOPES.has(requirement.scope);
  return tokenWrite ? "write" : "default";
}

export interface MappedError {
  readonly code: ErrorCode;
  readonly message: string;
  /** True when the error is unexpected and should be logged. */
  readonly unexpected: boolean;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof ZodError) {
    // Human-readable, one issue per line - not the raw issue JSON.
    return {
      code: "INVALID_REQUEST",
      message: z.prettifyError(error),
      unexpected: false,
    };
  }
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message, unexpected: false };
  }
  return {
    code: "INTERNAL",
    message: "Internal server error",
    unexpected: true,
  };
}
