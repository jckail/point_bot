import { toPortfolioSummaryDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/**
 * Aggregated portfolio view: totals, per-kind breakdown, last sync. When the
 * user prefers a non-USD display currency, `display` carries the converted
 * total (best-effort — an FX outage never breaks the summary).
 */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const { getPortfolioSummary, buildDisplayValue } = getContainer().useCases;
    const summary = await getPortfolioSummary.execute(userId);
    const display = await buildDisplayValue.execute(
      userId,
      summary.totalValueCents,
    );
    return NextResponse.json(toPortfolioSummaryDto(summary, display));
  });
}
