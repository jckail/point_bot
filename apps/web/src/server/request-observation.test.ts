import {
  PrometheusMetrics,
  createConsoleLogger,
  type Logger,
} from "@pointup/core";
import { describe, expect, it } from "vitest";

import {
  isAuthFailureCode,
  observeRequest,
  routeTemplate,
  spanAttributes,
  type RequestObservation,
} from "./request-observation";

const base: RequestObservation = {
  requestId: "req-12345678",
  method: "GET",
  route: "/api/v1/summary",
  status: 200,
  durationMs: 12.3456,
  principalKind: "token",
  tokenId: "tok_1",
  rateLimit: "allowed",
  rateLimitClass: "default",
};

function sinks() {
  const lines: Record<string, unknown>[] = [];
  const logger: Logger = createConsoleLogger({
    write: (l) => lines.push(JSON.parse(l)),
  });
  const metrics = new PrometheusMetrics();
  return { logger, metrics, lines };
}

describe("routeTemplate", () => {
  it("turns Next dynamic segments into bounded templates", () => {
    expect(routeTemplate("/api/v1/loyalty-accounts/[id]/balances")).toBe(
      "/api/v1/loyalty-accounts/{id}/balances",
    );
    expect(routeTemplate("/api/v1/x/[...rest]/route")).toBe("/api/v1/x/{...rest}");
    expect(routeTemplate(undefined)).toBe("unknown");
  });
});

describe("observeRequest", () => {
  it("logs one line with the agreed fields and never a token", () => {
    const s = sinks();
    observeRequest(s, base);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({
      level: "info",
      msg: "http_request",
      requestId: "req-12345678",
      method: "GET",
      route: "/api/v1/summary",
      status: 200,
      durationMs: 12.35,
      principal: "token",
      tokenId: "tok_1",
      rateLimit: "allowed",
    });
  });

  it("records request metrics by route, method and status class", () => {
    const s = sinks();
    observeRequest(s, base);
    observeRequest(s, { ...base, status: 503, errorCode: "INTERNAL" });
    const text = s.metrics.render();
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/summary",status_class="2xx"} 1',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/summary",status_class="5xx"} 1',
    );
    expect(text).toContain("http_request_duration_ms_count");
    expect(text).not.toContain("auth_failures_total");
  });

  it("counts rate limiting and auth failures, and uses warn/error levels", () => {
    const s = sinks();
    observeRequest(s, { ...base, status: 429, rateLimit: "limited", errorCode: "RATE_LIMITED" });
    observeRequest(s, {
      ...base,
      status: 401,
      principalKind: "anonymous",
      tokenId: undefined,
      rateLimit: "skipped",
      errorCode: "UNAUTHENTICATED",
    });
    observeRequest(s, { ...base, status: 500, errorCode: "INTERNAL" });
    const text = s.metrics.render();
    expect(text).toContain('rate_limited_total{class="default"} 1');
    expect(text).toContain('auth_failures_total{reason="UNAUTHENTICATED"} 1');
    expect(s.lines.map((l) => l.level)).toEqual(["warn", "warn", "error"]);
    expect(s.lines[1]).not.toHaveProperty("tokenId");
  });
});

describe("helpers", () => {
  it("classifies auth failure codes", () => {
    expect(isAuthFailureCode("CSRF_REJECTED")).toBe(true);
    expect(isAuthFailureCode("INSUFFICIENT_SCOPE")).toBe(true);
    expect(isAuthFailureCode("INVALID_REQUEST")).toBe(false);
    expect(isAuthFailureCode(undefined)).toBe(false);
  });
  it("exposes span attributes without the token", () => {
    const attrs = spanAttributes(base);
    expect(attrs["token.id"]).toBe("tok_1");
    expect(attrs["http.route"]).toBe("/api/v1/summary");
    expect(JSON.stringify(attrs)).not.toMatch(/pu_/);
  });
});
