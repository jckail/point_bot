import { ensureObservability, type Observability } from "@pointup/core";

/** Process-wide telemetry for the web surface (idempotent; see docs/observability.md). */
export function webObservability(): Observability {
  return ensureObservability({ service: "pointup-web" });
}
