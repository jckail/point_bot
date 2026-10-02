import { NextResponse } from "next/server";
import { getAgentServices } from "@/server/agents/container";
import { agentRecordIdSchema, reviewObservationSchema } from "@/server/agents/schemas";
import { readJsonBody, withBrowserAuthenticatedUser } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return withBrowserAuthenticatedUser(request, async (userId) => {
    const { id } = await context.params;
    const body = reviewObservationSchema.parse(await readJsonBody(request));
    return NextResponse.json(await getAgentServices().reviewObservation.execute({ userId, observationId: agentRecordIdSchema.parse(id), ...body }));
  });
}
