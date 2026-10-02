import {
  createTripGoalRequestSchema,
  toTripGoalDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";

export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const goals = await getContainer().useCases.listTripGoals.execute(userId);
    return NextResponse.json(goals.map(toTripGoalDto));
  }, { request: request, scope: "portfolio:read" });
}

export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = createTripGoalRequestSchema.parse(await readJsonBody(request));
    const goal = await getContainer().useCases.createTripGoal.execute({
      userId,
      title: body.title,
      targetPoints: body.targetPoints,
      targetDate: body.targetDate,
      accountIds: body.accountIds,
      notes: body.notes,
    });
    return NextResponse.json(toTripGoalDto(goal), { status: 201 });
  }, { request: request, scope: "portfolio:write" });
}
