import { toValueAdviceDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Bang-for-buck transfers + curated deals for the signed-in portfolio. */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const advice =
      await getContainer().useCases.getValueAdvice.execute(userId);
    return NextResponse.json(toValueAdviceDto(advice));
  });
}
