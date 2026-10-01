import { NextResponse } from "next/server";

import { checkMetricsAccess } from "@/server/metrics-access";
import { webObservability } from "@/server/observability";

/**
 * Prometheus text exposition. Default off: 404 unless METRICS_ENABLED=true and
 * METRICS_TOKEN is set; scrapers authenticate with a bearer METRICS_TOKEN.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const access = checkMetricsAccess({
    enabled: process.env.METRICS_ENABLED,
    token: process.env.METRICS_TOKEN,
    authorization: request.headers.get("authorization"),
  });
  if (access === "disabled") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (access === "unauthorized") {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="metrics"' },
    });
  }
  return new NextResponse(webObservability().prometheus?.render() ?? "", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
