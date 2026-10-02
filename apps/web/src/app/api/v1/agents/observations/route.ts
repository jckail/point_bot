import { NextResponse } from "next/server";
import { getAgentServices } from "@/server/agents/container";
import { observationSchema } from "@/server/agents/schemas";
import { HttpAuthError } from "@/server/agents/auth";
import { readJsonBody, withAuthenticatedUser, withBrowserAuthenticatedUser } from "@/server/http";
export function GET(request: Request) {
  return withBrowserAuthenticatedUser(request, async (userId) => NextResponse.json(await getAgentServices().listObservations.execute(userId)));
}
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId, principal) => {
    if (principal.kind !== "agent") throw new HttpAuthError(403, "FORBIDDEN", "Use an explicitly scoped agent token for observations");
    const body = observationSchema.parse(await readJsonBody(request));
    const result = await getAgentServices().submitObservation.execute({ userId, tokenId: principal.tokenId, ...body });
    return NextResponse.json(result, { status: result.status === "held" ? 202 : 200 });
  }, { request, scope: "observations:write" });
}
