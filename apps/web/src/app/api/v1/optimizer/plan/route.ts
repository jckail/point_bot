import {
  planRedemptionQuerySchema,
  toPlanRedemptionResultDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/**
 * Ranked redemption plans for the caller's balances (transfer bonuses +
 * curated sweet spots). Estimates only: see each plan's `caveats`. When origin,
 * destination, dates and cabin are all given, real award space is searched
 * (if configured) and attached to matching plans.
 */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const q = planRedemptionQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const result = await getContainer().useCases.planRedemption.execute({
      userId,
      goal: {
        kind: q.goalKind ?? "any",
        targetProgramId: q.targetProgramId,
        minValueCpp: q.minValueCpp,
        quantity: q.quantity,
      },
      maxPlans: q.limit,
      award:
        q.origin && q.destination && q.dateFrom && q.dateTo && q.cabin
          ? {
              origin: q.origin,
              destination: q.destination,
              dateFrom: q.dateFrom,
              dateTo: q.dateTo,
              cabin: q.cabin,
            }
          : undefined,
    });
    return NextResponse.json(toPlanRedemptionResultDto(result));
  }, { method: "GET", scope: "portfolio:read" });
}
