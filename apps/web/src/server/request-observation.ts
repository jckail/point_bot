import {
  METRIC_NAMES,
  statusClass,
  type Logger,
  type Metrics,
} from "@pointup/core";

/**
 * Pure request-telemetry helpers used by `http.ts`: kept free of Next imports
 * so the log/metric shapes are unit-tested.
 */

export type PrincipalKind = "session" | "token" | "anonymous";
export type RateLimitOutcome = "allowed" | "limited" | "skipped";

/** Error codes that count as authentication/authorization failures. */
const AUTH_FAILURE_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "INSUFFICIENT_SCOPE",
  "CSRF_REJECTED",
]);

export function isAuthFailureCode(code: string | undefined): boolean {
  return code !== undefined && AUTH_FAILURE_CODES.has(code);
}

/**
 * Next's route (`/api/v1/loyalty-accounts/[id]`) -> low-cardinality template
 * (`/api/v1/loyalty-accounts/{id}`). Unknown stays "unknown" so labels are bounded.
 */
export function routeTemplate(route: string | null | undefined): string {
  if (!route) return "unknown";
  return route
    .replace(/\/route$/, "")
    .replace(/\[\.\.\.([^\]]+)\]/g, "{...$1}")
    .replace(/\[([^\]]+)\]/g, "{$1}");
}

export interface RequestObservation {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  readonly principalKind: PrincipalKind;
  /** Access-token id (never the token itself). */
  readonly tokenId?: string | undefined;
  readonly rateLimit: RateLimitOutcome;
  readonly rateLimitClass?: string | undefined;
  readonly errorCode?: string | undefined;
}

/** Span attributes for an observed request (also unit-tested). */
export function spanAttributes(o: RequestObservation) {
  return {
    "http.request.method": o.method,
    "http.route": o.route,
    "http.response.status_code": o.status,
    "request.id": o.requestId,
    "principal.kind": o.principalKind,
    "token.id": o.tokenId,
    "rate_limit.outcome": o.rateLimit,
    "error.code": o.errorCode,
  };
}

/** One structured log line + the HTTP metrics for a finished request. */
export function observeRequest(
  sinks: { readonly logger: Logger; readonly metrics: Metrics },
  o: RequestObservation,
): void {
  const { logger, metrics } = sinks;
  metrics.counter(METRIC_NAMES.http_requests_total, {
    route: o.route,
    method: o.method,
    status_class: statusClass(o.status),
  });
  metrics.histogram(METRIC_NAMES.http_request_duration_ms, o.durationMs, {
    route: o.route,
    method: o.method,
  });
  if (o.rateLimit === "limited") {
    metrics.counter(METRIC_NAMES.rate_limited_total, {
      class: o.rateLimitClass ?? "unknown",
    });
  }
  if (isAuthFailureCode(o.errorCode)) {
    metrics.counter(METRIC_NAMES.auth_failures_total, {
      reason: o.errorCode as string,
    });
  }
  const level =
    o.status >= 500 ? "error" : o.status >= 400 ? "warn" : "info";
  logger[level]("http_request", {
    requestId: o.requestId,
    method: o.method,
    route: o.route,
    status: o.status,
    durationMs: Math.round(o.durationMs * 100) / 100,
    principal: o.principalKind,
    ...(o.tokenId ? { tokenId: o.tokenId } : {}),
    rateLimit: o.rateLimit,
    ...(o.errorCode ? { errorCode: o.errorCode } : {}),
  });
}
