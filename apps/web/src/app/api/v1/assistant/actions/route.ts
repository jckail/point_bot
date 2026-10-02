import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assistantActionProposalRequestSchema } from "@pointup/core/assistant-actions";
import { getAssistantActions } from "@/server/assistant-agent/actions";
import { readJsonBody, withAuthenticatedUser, withBrowserAuthenticatedUser } from "@/server/http";

export function GET(request: Request) {
  return withBrowserAuthenticatedUser(request, async userId => NextResponse.json({ actions: await getAssistantActions().list(userId) }));
}

/** Tokens can propose changes; they cannot confirm or execute them. */
export function POST(request: Request) {
  return withAuthenticatedUser(async userId => {
    const body = assistantActionProposalRequestSchema.parse(await readJsonBody(request));
    const service = getAssistantActions();
    const input = { ...body, userId, requestId: randomUUID() };
    const action = body.kind === "manual_balance"
      ? await service.proposeManualBalance({ ...input, accountId: body.accountId, points: body.points, capturedAt: body.capturedAt })
      : await service.proposeTripGoal({ ...input, title: body.title, targetPoints: body.targetPoints, targetDate: body.targetDate, accountIds: body.accountIds, notes: body.notes });
    return NextResponse.json({ action }, { status: 201 });
  }, { request, scope: "actions:propose" });
}
