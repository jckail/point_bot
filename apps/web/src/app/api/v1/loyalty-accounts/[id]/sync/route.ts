import {
  syncLoyaltyAccountRequestSchema,
  toBalanceDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = syncLoyaltyAccountRequestSchema.parse(
      await readJsonBody(request, true),
    );

    const balance = await getContainer().useCases.syncLoyaltyAccount.execute({
      userId,
      accountId: id,
      transientCredential: body.transientCredential,
    });
    return NextResponse.json(toBalanceDto(balance));
  }, { request: request, scope: "sync:execute", browserOnly: true });
}
