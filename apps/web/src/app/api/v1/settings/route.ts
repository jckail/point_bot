import {
  toUserSettingsDto,
  updateUserSettingsRequestSchema,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Display settings (currency); defaults to USD when never saved. */
export function GET() {
  return withAuthenticatedUser(async (userId) => {
    const settings = await getContainer().useCases.getUserSettings.execute(userId);
    return NextResponse.json(toUserSettingsDto(settings));
  });
}

/** Set the display currency. Values remain USD-denominated internally. */
export function PUT(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = updateUserSettingsRequestSchema.parse(await request.json());
    const settings = await getContainer().useCases.setDisplayCurrency.execute(
      userId,
      body.displayCurrency,
    );
    return NextResponse.json(toUserSettingsDto(settings));
  });
}
