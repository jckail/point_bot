import {
  bulkUpdateMembershipRequestSchema,
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

/**
 * Bulk-edit membership numbers across many accounts in one request. Returns a
 * per-item outcome: how many succeeded and which failed (e.g. an account the
 * user does not own), without failing the whole batch.
 */
export function PATCH(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = bulkUpdateMembershipRequestSchema.parse(await request.json());
    const result =
      await getContainer().useCases.bulkUpdateMembershipNumbers.execute({
        userId,
        updates: body.updates,
      });
    return NextResponse.json(result);
  });
}
