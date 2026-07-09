import {
  linkLoyaltyAccountRequestSchema,
  toLoyaltyAccountDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const accounts =
      await getContainer().useCases.listLoyaltyAccounts.execute(userId);
    return NextResponse.json(accounts.map(toLoyaltyAccountDto));
  });
}

export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = linkLoyaltyAccountRequestSchema.parse(await request.json());
    const result = await getContainer().useCases.linkLoyaltyAccount.execute({
      userId,
      providerId: body.providerId,
      membershipNumber: body.membershipNumber,
      credentialRef: body.credentialRef,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
