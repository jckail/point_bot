import {
  createTripGoalRequestSchema,
  toTripGoalDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const goals = await getContainer().useCases.listTripGoals.execute(userId);
    return NextResponse.json(goals.map(toTripGoalDto));
  });
}

export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = createTripGoalRequestSchema.parse(await request.json());
    const goal = await getContainer().useCases.createTripGoal.execute({
      userId,
      title: body.title,
      targetPoints: body.targetPoints,
      targetDate: body.targetDate,
      accountIds: body.accountIds,
      notes: body.notes,
    });
    return NextResponse.json(toTripGoalDto(goal), { status: 201 });
  });
}
