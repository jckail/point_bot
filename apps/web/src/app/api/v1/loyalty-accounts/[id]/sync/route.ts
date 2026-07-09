import {
  syncLoyaltyAccountRequestSchema,
  toBalanceDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = syncLoyaltyAccountRequestSchema.parse(
      await request.json().catch(() => ({})),
    );

    const balance = await getContainer().useCases.syncLoyaltyAccount.execute({
      userId,
      accountId: id,
      transientCredential: body.transientCredential,
    });
    return NextResponse.json(toBalanceDto(balance));
  });
}
