import { auth } from "@clerk/nextjs/server";
import {
  DomainError,
  InsufficientScopeError,
  requireScope,
  type AccessTokenScope,
} from "@pointup/core";
import {
  httpStatusForErrorCode,
  type ApiError,
} from "@pointup/core/contracts";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getContainer } from "@/server/container";

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

export interface AuthOptions {
  /**
   * Scope a personal access token must hold. Browser/Clerk sessions are
   * trusted for every scope (the user is present); tokens are least-privilege.
   */
  readonly scope: AccessTokenScope;
  /** Reject tokens outright (e.g. minting new tokens). */
  readonly sessionOnly?: boolean;
}

async function resolvePrincipal(): Promise<
  { userId: string; scopes: readonly AccessTokenScope[] | "session" } | null
> {
  const authorization = (await headers()).get("authorization");
  if (authorization?.startsWith("Bearer pu_")) {
    const principal =
      await getContainer().useCases.authenticateAccessToken.execute(
        authorization.slice("Bearer ".length).trim(),
      );
    return { userId: principal.userId, scopes: principal.scopes };
  }
  const { userId } = await auth();
  return userId ? { userId, scopes: "session" } : null;
}

export async function withAuthenticatedUser(
  handler: (userId: string) => Promise<NextResponse>,
  options: AuthOptions,
): Promise<NextResponse> {
  try {
    const principal = await resolvePrincipal();
    if (!principal) {
      return errorResponse("UNAUTHENTICATED", "Sign in required");
    }
    if (options.sessionOnly && principal.scopes !== "session") {
      throw new InsufficientScopeError("session");
    }
    requireScope(principal.scopes, options.scope);
    return await handler(principal.userId);
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
