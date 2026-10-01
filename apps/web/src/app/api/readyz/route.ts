import { pingDb } from "@pointup/core";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";

/** Readiness: 200 only when the database answers; 503 otherwise. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pingDb(getContainer().db);
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
