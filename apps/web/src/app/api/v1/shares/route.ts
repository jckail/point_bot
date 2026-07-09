import {
  createPortfolioShareRequestSchema,
  toPortfolioShareDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const shares =
      await getContainer().useCases.listPortfolioShares.execute(userId);
    return NextResponse.json(shares.map(toPortfolioShareDto));
  });
}

export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = createPortfolioShareRequestSchema.parse(await request.json());
    const share = await getContainer().useCases.createPortfolioShare.execute({
      userId,
      label: body.label,
      expiresInDays: body.expiresInDays,
    });
    return NextResponse.json(toPortfolioShareDto(share), { status: 201 });
  });
}
