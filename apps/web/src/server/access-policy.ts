import {
  DomainError,
  InsufficientScopeError,
  requireScope,
  type AccessTokenScope,
  type RateLimitPolicy,
} from "@pointup/core";
import { z, ZodError } from "zod";

/**
 * Framework-free auth/scope/rate-limit/error-mapping logic used by
 * `http.ts`. Kept free of Next/Clerk imports so it is unit-testable.
 */

export type Scopes = readonly AccessTokenScope[] | "session";

export interface Principal {
  readonly userId: string;
  readonly scopes: Scopes;
  /** Present for personal access tokens; absent for browser sessions. */
  readonly tokenId?: string;
}

export type RateLimitClass = "default" | "write" | "observations";

export interface AccessRequirement {
  readonly scope: AccessTokenScope;
  readonly sessionOnly?: boolean;
  /** Override the limit class (derived from the scope when omitted). */
  readonly rateLimit?: RateLimitClass;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitClass, RateLimitPolicy> = {
  default: { limit: 120, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  observations: { limit: 10, windowMs: 60_000 },
};

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
  readonly code: string;
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
