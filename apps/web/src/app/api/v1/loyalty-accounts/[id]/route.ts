import {
  toLoyaltyAccountDto,
  updateLoyaltyAccountRequestSchema,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function GET(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const account = await getContainer().useCases.getLoyaltyAccount.execute(
      userId,
      id,
    );
    return NextResponse.json(toLoyaltyAccountDto(account));
  });
}

export function PATCH(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = updateLoyaltyAccountRequestSchema.parse(await request.json());

    await getContainer().useCases.updateLoyaltyAccount.execute({
      userId,
      accountId: id,
      membershipNumber: body.membershipNumber,
      credentialRef: body.credentialRef,
      expiresAt:
        body.expiresAt === undefined
          ? undefined
          : body.expiresAt === null
            ? null
            : new Date(body.expiresAt),
      notes: body.notes,
      tags: body.tags,
      pinned: body.pinned,
    });

    const account = await getContainer().useCases.getLoyaltyAccount.execute(
      userId,
      id,
    );
    return NextResponse.json(toLoyaltyAccountDto(account));
  });
}

export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    await getContainer().useCases.unlinkLoyaltyAccount.execute(userId, id);
    return new NextResponse(null, { status: 204 });
  });
}
