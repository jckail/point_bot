import { toLoyaltyAccountDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

const querySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).optional(),
});

/** Accounts whose balances expire within the given window (default 90 days). */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const { withinDays } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const accounts =
      await getContainer().useCases.listExpiringAccounts.execute(
        userId,
        withinDays,
      );
    return NextResponse.json(accounts.map(toLoyaltyAccountDto));
  });
}
