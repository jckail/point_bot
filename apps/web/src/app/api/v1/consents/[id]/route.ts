import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

/** Revoking is always safe, so tokens holding `consents:manage` may do it. */
export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(
    async (userId) => {
      const { id } = await context.params;
      await getContainer().useCases.revokeConsent.execute(userId, id);
      return new NextResponse(null, { status: 204 });
    },
    { scope: "consents:manage" },
  );
}
