import { toSyncOutcomeDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Best-effort sync of every linked account; reports per-account outcomes. */
export function POST() {
  return withAuthenticatedUser(async (userId) => {
    const outcomes =
      await getContainer().useCases.syncAllLoyaltyAccounts.execute(userId);
    return NextResponse.json(outcomes.map(toSyncOutcomeDto));
  });
}
