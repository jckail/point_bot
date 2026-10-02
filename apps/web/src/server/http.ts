import { type AccessTokenScope, type ErrorCode, REQUEST_ID_HEADER, resolveRequestId, runWithRequestContext, type UserId } from "@pointup/core";
import {
  httpStatusForErrorCode,
  type ApiError,
} from "@pointup/core/contracts";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";

import { resolveRequestPrincipal } from "@/server/auth";
import { env } from "@/env";
import { getContainer } from "@/server/container";
import {
  RATE_LIMIT_POLICIES,
  assertCsrfSafe,
  authorize,
  mapError,
  rateLimitClassFor,
  rateLimitKey,
  parseAppOrigin,
  type Principal,
  type RateLimitClass,
} from "@/server/access-policy";
import { webObservability } from "@/server/observability";
import { getRateLimiter } from "@/server/rate-limit";
import {
  observeRequest,
  routeTemplate,
  spanAttributes,
  type PrincipalKind,
  type RateLimitOutcome,
} from "@/server/request-observation";

/**
 * Shared HTTP concerns for the v1 API: auth guard, rate limiting and uniform
 * error serialization. Route handlers stay thin controllers over use cases;
 * the pure decisions live in `access-policy.ts`.
 */

function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  extraHeaders?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status: httpStatusForErrorCode(code), headers: extraHeaders },
  );
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface AuthOptions {
  /** HTTP method of the exported handler; labels telemetry (route handlers do not expose it). */
  readonly method?: HttpMethod;
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

async function checkCsrf(principal: Principal, method?: HttpMethod): Promise<void> {
  if (principal.scopes !== "session" || principal.credential === "clerk-bearer") return;
  const h = await headers();
  const length = h.get("content-length");
  assertCsrfSafe({
    principal,
    origin: h.get("origin"),
    expectedOrigin: env.APP_URL ?? parseAppOrigin(`${env.NODE_ENV === "production" ? "https" : "http"}://${h.get("host") ?? ""}`),
    method,
    secFetchSite: h.get("sec-fetch-site"),
    contentType: h.get("content-type"),
    hasBody: h.has("transfer-encoding") || (length !== null && length !== "0"),
  });
}

/** Mutable per-request facts gathered while the request runs, for telemetry. */
interface RequestState {
  principal?: Principal;
  rateLimit: RateLimitOutcome;
  rateLimitClass?: RateLimitClass;
  errorCode?: ErrorCode;
}

function principalKind(principal: Principal | undefined): PrincipalKind {
  if (!principal) return "anonymous";
  return principal.tokenId ? "token" : "session";
}

/** Next's route template for the current handler (e.g. `/api/v1/accounts/[id]`). */
function currentRoute(): string {
  try {
    return routeTemplate(workAsyncStorage.getStore()?.route);
  } catch {
    return "unknown";
  }
}

async function authenticatedResponse(
  handler: (userId: UserId, principal: Principal) => Promise<NextResponse>,
  options: AuthOptions,
  requestId: string,
  state: RequestState,
): Promise<NextResponse> {
  try {
    const principal = await resolveRequestPrincipal(options, token =>
      getContainer().useCases.authenticateAccessToken.execute(token),
    );
    if (!principal) {
      state.errorCode = "UNAUTHENTICATED";
      return errorResponse("UNAUTHENTICATED", "Sign in required", requestId);
    }
    state.principal = principal;
    await checkCsrf(principal, options.method);
    authorize(principal, options);

    const cls = rateLimitClassFor(principal, options);
    state.rateLimitClass = cls;
    const decision = await getRateLimiter().consume(
      rateLimitKey(principal, cls),
      RATE_LIMIT_POLICIES[cls],
    );
    state.rateLimit = decision.allowed ? "allowed" : "limited";
    if (!decision.allowed) {
      state.errorCode = "RATE_LIMITED";
      return errorResponse("RATE_LIMITED", "Too many requests", requestId, {
        "Retry-After": String(decision.retryAfterSeconds),
        "RateLimit-Limit": String(decision.limit),
        "RateLimit-Remaining": "0",
      });
    }
    return await handler(principal.userId, principal);
  } catch (error) {
    const mapped = mapError(error);
    state.errorCode = mapped.code;
    if (mapped.unexpected) {
      webObservability().logger.error("unhandled_api_error", { error });
    }
    return errorResponse(mapped.code, mapped.message, requestId);
  }
}

/**
 * Auth guard + rate limit + uniform errors, wrapped in request telemetry:
 * correlation id (`x-request-id` accepted/generated and echoed), a span, one
 * log line and the HTTP metrics per request.
 */
export async function withAuthenticatedUser(
  handler: (userId: UserId, principal: Principal) => Promise<NextResponse>,
  options: AuthOptions,
): Promise<NextResponse> {
  const obs = webObservability();
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  const method = options.method ?? "UNKNOWN";
  const route = currentRoute();
  const started = performance.now();
  const state: RequestState = { rateLimit: "skipped" };

  return runWithRequestContext({ requestId }, async () => {
    const response = await obs.tracer.withSpan(
      `${method} ${route}`,
      { "http.request.method": method, "http.route": route, "request.id": requestId },
      async (span) => {
        const res = await authenticatedResponse(handler, options, requestId, state);
        span.setAttributes(
          spanAttributes({
            requestId,
            method,
            route,
            status: res.status,
            durationMs: 0,
            principalKind: principalKind(state.principal),
            tokenId: state.principal?.tokenId,
            rateLimit: state.rateLimit,
            errorCode: state.errorCode,
          }),
        );
        return res;
      },
    );
    try {
      response.headers.set(REQUEST_ID_HEADER, requestId);
    } catch {
      /* immutable headers (e.g. a redirect from a cache): skip */
    }
    observeRequest(obs, {
      requestId,
      method,
      route,
      status: response.status,
      durationMs: performance.now() - started,
      principalKind: principalKind(state.principal),
      tokenId: state.principal?.tokenId,
      rateLimit: state.rateLimit,
      rateLimitClass: state.rateLimitClass,
      errorCode: state.errorCode,
    });
    return response;
  });
}
