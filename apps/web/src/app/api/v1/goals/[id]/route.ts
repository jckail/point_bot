import {
  toTripGoalDto,
  updateTripGoalRequestSchema,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

import { LoyaltyAccountId, TripGoalId } from "@pointup/core";
type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = updateTripGoalRequestSchema.parse(await request.json());
    const goal = await getContainer().useCases.updateTripGoal.execute({
      userId,
      goalId: TripGoalId.parse(id),
      title: body.title,
      targetPoints: body.targetPoints,
      targetDate: body.targetDate,
      accountIds: body.accountIds?.map((accountId) =>
        LoyaltyAccountId.parse(accountId),
      ),
      status: body.status,
      notes: body.notes,
    });
    return NextResponse.json(toTripGoalDto(goal));
  }, { method: "PATCH", scope: "portfolio:write" });
}

export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    await getContainer().useCases.deleteTripGoal.execute(userId, TripGoalId.parse(id));
    return new NextResponse(null, { status: 204 });
  }, { method: "DELETE", scope: "portfolio:write" });
}
