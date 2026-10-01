import { toObservationResultDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Human-only: releases/discards a reading the server held for review. Session
 * auth only, so a token (and therefore an agent) can never approve its own
 * held value. The review id is single-use and expires after 24 hours.
 */
export function POST(_request: Request, context: Context) {
  return withAuthenticatedUser(
    async (userId) => {
      const { id } = await context.params;
      const result = await getContainer().useCases.resolveObservationReview.confirm(
        userId,
        id,
      );
      return NextResponse.json(toObservationResultDto(result));
    },
    { scope: "observations:write", sessionOnly: true },
  );
}
