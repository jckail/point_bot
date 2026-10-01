import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

import { AccessTokenId } from "@pointup/core";
type Context = { params: Promise<{ id: string }> };

export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(
    async (userId) => {
      const { id } = await context.params;
      await getContainer().useCases.revokeAccessToken.execute(userId, AccessTokenId.parse(id));
      return new NextResponse(null, { status: 204 });
    },
    { method: "DELETE", scope: "consents:manage", sessionOnly: true },
  );
}
