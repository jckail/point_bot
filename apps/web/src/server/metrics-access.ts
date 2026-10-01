import { timingSafeEqual } from "node:crypto";

/**
 * Gate for the Prometheus `/metrics` endpoint. Off unless
 * METRICS_ENABLED=true AND a METRICS_TOKEN is set; scrapers send
 * `Authorization: Bearer <METRICS_TOKEN>`.
 */
export const METRICS_ACCESS_RESULTS = ["disabled", "unauthorized", "ok"] as const;
export type MetricsAccess = (typeof METRICS_ACCESS_RESULTS)[number];

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Compare against self on a length mismatch to keep timing uniform.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function checkMetricsAccess(input: {
  enabled: string | undefined;
  token: string | undefined;
  authorization: string | null;
}): MetricsAccess {
  if (input.enabled?.trim().toLowerCase() !== "true" || !input.token) {
    return "disabled";
  }
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() ?? "");
  return match && constantTimeEqual(match[1]!.trim(), input.token)
    ? "ok"
    : "unauthorized";
}
