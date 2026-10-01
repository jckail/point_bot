import {
  grantConsentRequestSchema,
  toConsentDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

export function GET() {
  return withAuthenticatedUser(
    async (userId) => {
      const consents = await getContainer().useCases.listConsents.execute(userId);
      return NextResponse.json(consents.map(toConsentDto));
    },
    { scope: "portfolio:read" },
  );
}

/** Granting consent is a user decision; tokens need `consents:manage`. */
export function POST(request: Request) {
  return withAuthenticatedUser(
    async (userId) => {
      const body = grantConsentRequestSchema.parse(await request.json());
      const consent = await getContainer().useCases.grantConsent.execute({
        userId,
        ...body,
      });
      return NextResponse.json(toConsentDto(consent), { status: 201 });
    },
    { scope: "consents:manage" },
  );
}
