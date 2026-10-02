import {
  createAwardWatchRequestSchema,
  toAwardWatchDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";

/** List the caller's award watches. */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const watches =
      await getContainer().useCases.listAwardWatches.execute(userId);
    return NextResponse.json(watches.map(toAwardWatchDto));
  }, { request: request, scope: "portfolio:read" });
}

/** Watch an award/deal page; the worker re-scrapes and notifies on improvement. */
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = createAwardWatchRequestSchema.parse(await readJsonBody(request));
    const watch = await getContainer().useCases.createAwardWatch.execute({
      userId,
      url: body.url,
      label: body.label,
      minCentsPerPoint: body.minCentsPerPoint,
    });
    return NextResponse.json(toAwardWatchDto(watch), { status: 201 });
  }, { request: request, scope: "portfolio:write" });
}
