import {
  activityQuerySchema,
  toActivityEventDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Chronological activity feed for the signed-in user. */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const { limit } = activityQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const events = await getContainer().useCases.listActivity.execute(
      userId,
      limit,
    );
    return NextResponse.json(events.map(toActivityEventDto));
  });
}
