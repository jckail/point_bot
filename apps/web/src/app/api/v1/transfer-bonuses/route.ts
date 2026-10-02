import {
  bonusPercentToPermille,
  recordTransferBonusRequestSchema,
  toTransferBonusDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Active transfer bonuses. Crowd/manual data, empty by default. */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const bonuses =
      await getContainer().useCases.listActiveTransferBonuses.execute(userId);
    return NextResponse.json(bonuses.map(toTransferBonusDto));
  }, { method: "GET", scope: "portfolio:read" });
}

/**
 * Report a transfer bonus. It is stored as source "user", unverified, and
 * plans that use it say so. Validation (known programs, an existing transfer
 * path, 1.0 < multiplier <= 3.0, ends after starts) lives in the domain.
 */
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = recordTransferBonusRequestSchema.parse(await request.json());
    const bonus = await getContainer().useCases.recordTransferBonus.execute({
      fromProviderId: body.fromProviderId,
      toProviderId: body.toProviderId,
      multiplierPermille: bonusPercentToPermille(body.bonusPercent),
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      source: "user",
      sourceUrl: body.sourceUrl ?? null,
      createdBy: userId,
    });
    return NextResponse.json(toTransferBonusDto(bonus), { status: 201 });
  }, { method: "POST", scope: "portfolio:write" });
}
