import { toObservationResultDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

import { ObservationId, userCacheTag } from "@pointup/core";
import { z } from "zod";
import { readJsonBody } from "@/server/request-body";
import { getReadCache } from "@/server/read-cache";
type Context = { params: Promise<{ id: string }> };

/**
 * Human-only: releases/discards a reading the server held for review. Session
 * auth only, so a token (and therefore an agent) can never approve its own
 * held value. The review id is single-use and expires after 24 hours.
 */
export function POST(request: Request, context: Context) {
  return withAuthenticatedUser(
    async (userId) => {
      z.object({}).strict().parse(await readJsonBody(request, true, 32 * 1024));
      const { id } = await context.params;
      try {
        const result = await getContainer().useCases.resolveObservationReview.confirm(
          userId,
          ObservationId.parse(id),
        );
        return NextResponse.json(toObservationResultDto(result));
      } finally {
        await getReadCache().invalidateTag(userCacheTag(userId));
      }
    },
    { method: "POST", scope: "observations:write", sessionOnly: true },
  );
}
