import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    await getContainer().useCases.revokePortfolioShare.execute(userId, id);
    return new NextResponse(null, { status: 204 });
  });
}
