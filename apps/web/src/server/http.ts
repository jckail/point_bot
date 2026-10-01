import { type AccessTokenScope } from "@pointup/core";
import {
  httpStatusForErrorCode,
  type ApiError,
} from "@pointup/core/contracts";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/server/auth";
import { getContainer } from "@/server/container";
import {
  RATE_LIMIT_POLICIES,
  assertCsrfSafe,
  authorize,
  mapError,
  rateLimitClassFor,
  rateLimitKey,
  type Principal,
  type RateLimitClass,
} from "@/server/access-policy";
import { getRateLimiter } from "@/server/rate-limit";

/**
 * Shared HTTP concerns for the v1 API: auth guard, rate limiting and uniform
 * error serialization. Route handlers stay thin controllers over use cases;
 * the pure decisions live in `access-policy.ts`.
 */

function errorResponse(
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message } },
    { status: httpStatusForErrorCode(code), headers: extraHeaders },
  );
}

export interface AuthOptions {
  /**
   * Scope a personal access token must hold. Browser sessions (Clerk, or the fixed dev user in dev mode) are
   * trusted for every scope (the user is present); tokens are least-privilege.
   */
  readonly scope: AccessTokenScope;
  /** Reject tokens outright (e.g. minting new tokens). */
  readonly sessionOnly?: boolean;
  /** Rate-limit class; defaults from the scope (token writes are stricter). */
  readonly rateLimit?: RateLimitClass;
}

async function resolvePrincipal(): Promise<Principal | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization?.startsWith("Bearer pu_")) {
    const principal =
      await getContainer().useCases.authenticateAccessToken.execute(
        authorization.slice("Bearer ".length).trim(),
      );
    return {
      userId: principal.userId,
      scopes: principal.scopes,
      tokenId: principal.tokenId,
    };
  }
  const userId = await getSessionUserId();
  return userId ? { userId, scopes: "session" } : null;
}

async function checkCsrf(principal: Principal): Promise<void> {
  const h = await headers();
  const length = h.get("content-length");
  assertCsrfSafe({
    principal,
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    secFetchSite: h.get("sec-fetch-site"),
    contentType: h.get("content-type"),
    hasBody: h.has("transfer-encoding") || (length !== null && length !== "0"),
  });
}

export async function withAuthenticatedUser(
  handler: (userId: string, principal: Principal) => Promise<NextResponse>,
  options: AuthOptions,
): Promise<NextResponse> {
  try {
    const principal = await resolvePrincipal();
    if (!principal) {
      return errorResponse("UNAUTHENTICATED", "Sign in required");
    }
    await checkCsrf(principal);
    authorize(principal, options);

    const cls = rateLimitClassFor(principal, options);
    const decision = await getRateLimiter().consume(
      rateLimitKey(principal, cls),
      RATE_LIMIT_POLICIES[cls],
    );
    if (!decision.allowed) {
      return errorResponse("RATE_LIMITED", "Too many requests", {
        "Retry-After": String(decision.retryAfterSeconds),
        "RateLimit-Limit": String(decision.limit),
        "RateLimit-Remaining": "0",
      });
    }
    return await handler(principal.userId, principal);
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.unexpected) console.error("Unhandled API error", error);
    return errorResponse(mapped.code, mapped.message);
  }
}
