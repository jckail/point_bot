import { METRIC_NAMES, pingDb } from "@pointup/core";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { webObservability } from "@/server/observability";

/**
 * Readiness: 200 only when the database answers; 503 otherwise. `status`
 * stays the stable contract; `db.latencyMs` is additive diagnostics.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { metrics, logger } = webObservability();
  const started = performance.now();
  try {
    await pingDb(getContainer().db);
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    metrics.gauge(METRIC_NAMES.db_ping_latency_ms, latencyMs);
    return NextResponse.json({ status: "ready", db: { latencyMs } });
  } catch (error) {
    logger.error("readiness_failed", { error });
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
