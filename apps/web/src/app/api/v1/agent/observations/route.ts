import {
  submitObservationRequestSchema,
  toAgentObservationDto,
  toObservationResultDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { mayWritePortfolio } from "@/server/access-policy";
import { withAuthenticatedUser } from "@/server/http";
import { readJsonBody } from "@/server/request-body";

export function GET() {
  return withAuthenticatedUser(
    async (userId) => {
      const rows = await getContainer().useCases.listAgentObservations.execute(userId);
      return NextResponse.json(rows.map(toAgentObservationDto));
    },
    { method: "GET", scope: "portfolio:read" },
  );
}

/**
 * Agent write-back. Requires the `observations:write` scope AND an active
 * per-provider consent (enforced in the use case). Auto-linking a program
 * additionally needs `portfolio:write`. Implausible values are held and can
 * only be released by the signed-in user (see ./[id]/confirm).
 */
export function POST(request: Request) {
  return withAuthenticatedUser(
    async (userId, principal) => {
      const body = submitObservationRequestSchema.parse(await readJsonBody(request, false, 32 * 1024));
      const result = await getContainer().useCases.submitObservation.execute({
        userId,
        credential: principal.tokenId
          ? { kind: "personal_access_token", tokenId: principal.tokenId }
          : { kind: principal.credential === "clerk-bearer" ? "clerk_bearer" : "session" },
        captureId: body.captureId,
        sourceMethod: body.sourceMethod,
        skillId: body.skillId,
        points: body.points,
        sourceUrl: body.sourceUrl,
        agent: body.agent,
        observedAt: body.observedAt ? new Date(body.observedAt) : undefined,
        membershipNumber: body.membershipNumber,
        canLinkAccount: mayWritePortfolio(principal),
      });
      return NextResponse.json(toObservationResultDto(result));
    },
    { method: "POST", scope: "observations:write", rateLimit: "observations" },
  );
}
