import { toCustomValuationDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** List the caller's custom cents-per-point overrides. */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const valuations =
      await getContainer().useCases.listCustomValuations.execute(userId);
    return NextResponse.json(valuations.map(toCustomValuationDto));
  });
}
