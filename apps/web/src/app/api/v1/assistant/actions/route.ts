import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assistantActionProposalRequestSchema } from "@pointup/core/assistant-actions";
import { getAssistantActions } from "@/server/assistant-agent/actions";
import { withAuthenticatedUser } from "@/server/http";
import { readJsonBody } from "@/server/request-body";

const privateHeaders = { "Cache-Control": "private, no-store" };

export function GET() {
  return withAuthenticatedUser(async userId =>
    NextResponse.json({ actions: await getAssistantActions().list(userId) }, { headers: privateHeaders }),
  { method: "GET", scope: "portfolio:read" });
}

/** Proposals persist reviewed values; this route never executes them. */
export function POST(request: Request) {
  return withAuthenticatedUser(async userId => {
    const body = assistantActionProposalRequestSchema.parse(await readJsonBody(request));
    const service = getAssistantActions();
    const input = { userId, requestId: randomUUID() };
    const action = body.kind === "manual_balance"
      ? await service.proposeManualBalance({ ...input, accountId: body.accountId, points: body.points, capturedAt: body.capturedAt })
      : await service.proposeTripGoal({ ...input, title: body.title, targetPoints: body.targetPoints, targetDate: body.targetDate, accountIds: body.accountIds, notes: body.notes });
    return NextResponse.json({ action }, { status: 201, headers: privateHeaders });
  }, { method: "POST", scope: "portfolio:write" });
}
