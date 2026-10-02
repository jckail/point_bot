import {
  toUserSettingsDto,
  updateUserSettingsRequestSchema,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { readJsonBody, withAuthenticatedUser } from "@/server/http";

/** Display settings (currency); defaults to USD when never saved. */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const settings = await getContainer().useCases.getUserSettings.execute(userId);
    return NextResponse.json(toUserSettingsDto(settings));
  }, { request: request, scope: "portfolio:read" });
}

/** Set the display currency. Values remain USD-denominated internally. */
export function PUT(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = updateUserSettingsRequestSchema.parse(await readJsonBody(request));
    const settings = await getContainer().useCases.setDisplayCurrency.execute(
      userId,
      body.displayCurrency,
    );
    return NextResponse.json(toUserSettingsDto(settings));
  }, { request: request, scope: "portfolio:write" });
}
