import { NextResponse } from "next/server";
import { getAgentServices } from "@/server/agents/container";
import { agentRecordIdSchema } from "@/server/agents/schemas";
import { withBrowserAuthenticatedUser } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export function DELETE(request: Request, context: Context) {
  return withBrowserAuthenticatedUser(request, async (userId) => {
    const { id } = await context.params;
    await getAgentServices().revokeConsent.execute({ userId, consentId: agentRecordIdSchema.parse(id) });
    return NextResponse.json({ revoked: true });
  });
}
