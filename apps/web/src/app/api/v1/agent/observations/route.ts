import {
  submitObservationRequestSchema,
  toAgentObservationDto,
  toObservationResultDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(
    async (userId) => {
      const rows = await getContainer().useCases.listAgentObservations.execute(userId);
      return NextResponse.json(rows.map(toAgentObservationDto));
    },
    { scope: "portfolio:read" },
  );
}

/**
 * Agent write-back. Requires the `observations:write` scope AND an active
 * per-provider consent (enforced in the use case).
 */
export function POST(request: Request) {
  return withAuthenticatedUser(
    async (userId) => {
      const body = submitObservationRequestSchema.parse(await request.json());
      const result = await getContainer().useCases.submitObservation.execute({
        userId,
        skillId: body.skillId,
        points: body.points,
        sourceUrl: body.sourceUrl,
        agent: body.agent,
        observedAt: body.observedAt ? new Date(body.observedAt) : undefined,
        membershipNumber: body.membershipNumber,
        confirmed: body.confirmed,
      });
      return NextResponse.json(toObservationResultDto(result));
    },
    { scope: "observations:write", rateLimit: "observations" },
  );
}
