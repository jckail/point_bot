import { toPortfolioSummaryDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Aggregated portfolio view: totals, per-kind breakdown, last sync. */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const summary =
      await getContainer().useCases.getPortfolioSummary.execute(userId);
    return NextResponse.json(toPortfolioSummaryDto(summary));
  });
}
