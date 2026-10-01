import {
  createAccessTokenRequestSchema,
  toAccessTokenDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/**
 * Personal access tokens are minted and listed from a signed-in browser
 * session only - a token can never create another token.
 */
export function GET() {
  return withAuthenticatedUser(
    async (userId) => {
      const tokens = await getContainer().useCases.listAccessTokens.execute(userId);
      return NextResponse.json(tokens.map(toAccessTokenDto));
    },
    { method: "GET", scope: "consents:manage", sessionOnly: true },
  );
}

export function POST(request: Request) {
  return withAuthenticatedUser(
    async (userId) => {
      const body = createAccessTokenRequestSchema.parse(await request.json());
      const { token, plaintext } =
        await getContainer().useCases.issueAccessToken.execute({
          userId,
          ...body,
        });
      return NextResponse.json(
        { token: toAccessTokenDto(token), secret: plaintext },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    },
    { method: "POST", scope: "consents:manage", sessionOnly: true },
  );
}
