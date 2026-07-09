import { toDeletedAccountDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const deleted =
      await getContainer().useCases.listDeletedLoyaltyAccounts.execute(userId);
    return NextResponse.json(deleted.map(toDeletedAccountDto));
  });
}
