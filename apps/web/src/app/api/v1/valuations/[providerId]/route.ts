import {
  setCustomValuationRequestSchema,
  toCustomValuationDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

type Context = { params: Promise<{ providerId: string }> };

/** Set (or replace) the caller's cents-per-point override for a provider. */
export function PUT(request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { providerId } = await context.params;
    const body = setCustomValuationRequestSchema.parse(await request.json());
    const valuation = await getContainer().useCases.setCustomValuation.execute({
      userId,
      providerId,
      centsPerPoint: body.centsPerPoint,
    });
    return NextResponse.json(toCustomValuationDto(valuation));
  });
}

/** Clear the override, reverting the provider to its editorial valuation. */
export function DELETE(_request: Request, context: Context) {
  return withAuthenticatedUser(async (userId) => {
    const { providerId } = await context.params;
    await getContainer().useCases.deleteCustomValuation.execute(
      userId,
      providerId,
    );
    return new NextResponse(null, { status: 204 });
  });
}
