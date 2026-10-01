import { NextResponse } from "next/server";

/**
 * Liveness: used by the ALB target group (see infra/) and the container
 * healthcheck. Intentionally does not touch the database so the app stays
 * "healthy" during DB maintenance windows; see /api/readyz for readiness.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
