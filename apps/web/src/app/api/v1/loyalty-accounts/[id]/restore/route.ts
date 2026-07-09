import { toLoyaltyAccountDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function POST(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const account =
      await getContainer().useCases.restoreLoyaltyAccount.execute(userId, id);
    return NextResponse.json(toLoyaltyAccountDto(account));
  });
}
