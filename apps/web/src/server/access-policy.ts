import { type AccessTokenId, type AccessTokenScope, CsrfRejectedError, DomainError, type ErrorCode, InsufficientScopeError, type RateLimitPolicy, requireScope, type UserId } from "@pointup/core";
import { z, ZodError } from "zod";
import { RequestBodyError } from "./request-body";

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
  /** Set only after independent JWT verification and Clerk session agreement. */
  readonly credential?: "clerk-bearer";
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
  if (requirement.sessionOnly && (principal.scopes !== "session" || principal.credential === "clerk-bearer")) {
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
  /** Canonical app origin from configuration or the direct Host; never forwarded headers. */
  readonly expectedOrigin: string;
  readonly method?: string;
  readonly secFetchSite?: string | null;
  readonly contentType: string | null;
  /** True when the request carries a body (content-length > 0 or chunked). */
  readonly hasBody: boolean;
}

/** Configuration contains only an origin; errors never echo its value. */
export function parseAppOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("APP_URL must be an HTTP or HTTPS origin"); }
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(value) || !["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be an HTTP or HTTPS origin");
  }
  return url.origin;
}

/**
 * CSRF defence for cookie-session principals (bearer tokens are exempt: the
 * Authorization header cannot be set by a cross-site form). Applied to every
 * method: browsers omit Origin on same-origin GETs, so legitimate reads pass,
 * while a cross-origin request carrying the cookie is refused.
 *  - A present Origin must match the canonical scheme and host (`null` never matches).
 *  - Cookie mutations require Origin, even for body-less writes.
 *  - Request bodies must be application/json, which a plain cross-site form
 *    cannot send without a CORS preflight.
 */
export function assertCsrfSafe(input: CsrfInput): void {
  if (input.principal.scopes !== "session" || input.principal.credential === "clerk-bearer") return;
  if (input.secFetchSite === "cross-site") {
    throw new CsrfRejectedError("cross-site request");
  }
  if (input.origin !== null) {
    let origin: string;
    try {
      origin = parseAppOrigin(input.origin);
    } catch {
      throw new CsrfRejectedError("invalid Origin header");
    }
    if (origin !== input.expectedOrigin) {
      throw new CsrfRejectedError("Origin does not match the app origin");
    }
  }
  if (input.origin === null
      && !["GET", "HEAD", "OPTIONS"].includes((input.method ?? "UNKNOWN").toUpperCase())) {
    throw new CsrfRejectedError("Origin is required for browser mutations");
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
  if (error instanceof RequestBodyError && ["INVALID_REQUEST", "REQUEST_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"].includes(error.code)) {
    return { code: error.code as "INVALID_REQUEST" | "REQUEST_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE", message: error.message, unexpected: false };
  }
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
