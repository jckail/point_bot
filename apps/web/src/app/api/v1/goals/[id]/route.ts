import {
  toTripGoalDto,
  updateTripGoalRequestSchema,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = updateTripGoalRequestSchema.parse(await readJsonBody(request));
    const goal = await getContainer().useCases.updateTripGoal.execute({
      userId,
      goalId: id,
      title: body.title,
      targetPoints: body.targetPoints,
      targetDate: body.targetDate,
      accountIds: body.accountIds,
      status: body.status,
      notes: body.notes,
    });
    return NextResponse.json(toTripGoalDto(goal));
  }, { request: request, scope: "portfolio:write" });
}

export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    await getContainer().useCases.deleteTripGoal.execute(userId, id);
    return new NextResponse(null, { status: 204 });
  }, { request: _request, scope: "portfolio:write" });
}
