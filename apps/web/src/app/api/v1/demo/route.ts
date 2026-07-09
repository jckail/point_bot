import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Seed a sample portfolio when the user has no linked accounts. */
export function POST() {
  return withAuthenticatedUser(async (userId) => {
    const result =
      await getContainer().useCases.seedDemoPortfolio.execute(userId);
    return NextResponse.json(result, { status: 201 });
  });
}
