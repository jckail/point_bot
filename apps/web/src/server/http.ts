import { auth } from "@clerk/nextjs/server";
import { DomainError } from "@pointup/core";
import {
  httpStatusForErrorCode,
  type ApiError,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

/**
 * Shared HTTP concerns for the v1 API: auth guard and uniform error
 * serialization. Route handlers stay thin controllers over use cases; the
 * error-code -> status mapping lives in the shared contracts.
 */

function errorResponse(code: string, message: string): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message } },
    { status: httpStatusForErrorCode(code) },
  );
}

export async function withAuthenticatedUser(
  handler: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return errorResponse("UNAUTHENTICATED", "Sign in required");
  }

  try {
    return await handler(userId);
  } catch (error) {
    if (error instanceof ZodError) {
      // Human-readable, one issue per line - not the raw issue JSON.
      return errorResponse("INVALID_REQUEST", z.prettifyError(error));
    }
    if (error instanceof DomainError) {
      return errorResponse(error.code, error.message);
    }
    console.error("Unhandled API error", error);
    return errorResponse("INTERNAL", "Internal server error");
  }
}
