import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

import { AwardWatchId } from "@pointup/core";
type Context = { params: Promise<{ id: string }> };

/** Stop watching a page. */
export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    await getContainer().useCases.deleteAwardWatch.execute(userId, AwardWatchId.parse(id));
    return new NextResponse(null, { status: 204 });
  }, { method: "DELETE", scope: "portfolio:write" });
}
