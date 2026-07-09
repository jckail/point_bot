import { importPortfolioRequestSchema } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Rehydrate accounts + balances from a PointUp CSV export. */
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = importPortfolioRequestSchema.parse(await request.json());
    const result = await getContainer().useCases.importPortfolio.execute({
      userId,
      csv: body.csv,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
