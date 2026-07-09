import { NextResponse } from "next/server";

/**
 * Health check endpoint used by the ALB target group (see infra/).
 * Intentionally does not touch the database so the app stays "healthy"
 * during DB maintenance windows.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
