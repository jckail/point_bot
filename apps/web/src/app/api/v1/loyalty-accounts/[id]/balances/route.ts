import {
  balanceHistoryQuerySchema,
  recordManualBalanceRequestSchema,
  toBalanceDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

/** Balance history, newest first. Query: ?limit=1..365 (default 50). */
export function GET(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const { limit } = balanceHistoryQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    const history = await getContainer().useCases.getBalanceHistory.execute(
      userId,
      id,
      limit,
    );
    return NextResponse.json(history.map(toBalanceDto));
  });
}

/** Record a manually observed balance. */
export function POST(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { id } = await context.params;
    const body = recordManualBalanceRequestSchema.parse(await request.json());

    const balance = await getContainer().useCases.recordManualBalance.execute({
      userId,
      accountId: id,
      points: body.points,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : undefined,
    });
    return NextResponse.json(toBalanceDto(balance), { status: 201 });
  });
}
