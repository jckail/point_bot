import {
  listSweetSpotsQuerySchema,
  toSweetSpotDto,
} from "@pointup/core/contracts";
import { listSweetSpots } from "@pointup/core";
import { NextResponse } from "next/server";

import { withAuthenticatedUser } from "@/server/http";

/**
 * The curated, unverified sweet-spot catalog (typical points ranges, never
 * live prices or availability). Static editorial data, filterable.
 */
export function GET(request: Request) {
  return withAuthenticatedUser(async () => {
    const filter = listSweetSpotsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return NextResponse.json(listSweetSpots(filter).map(toSweetSpotDto));
  }, { method: "GET", scope: "portfolio:read" });
}
