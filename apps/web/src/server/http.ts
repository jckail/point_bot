import { auth, verifyToken } from "@clerk/nextjs/server";
import { DomainError } from "@pointup/core";
import {
  httpStatusForErrorCode,
  type ApiError,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkBrowserMutation, HttpAuthError, resolvePrincipal, type AgentScope, type AuthPrincipal } from "./agents/auth";
import { getAgentServices } from "./agents/container";
import { z, ZodError } from "zod";
import { RequestBodyError } from "./request-body";
export { readJsonBody } from "./request-body";

/**
 * Shared HTTP concerns for the v1 API: auth guard and uniform error
 * serialization. Route handlers stay thin controllers over use cases; the
 * error-code -> status mapping lives in the shared contracts.
 */

function privateResponse<T>(response: NextResponse<T>): NextResponse<T> {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function errorResponse(code: string, message: string): NextResponse<ApiError> {
  return privateResponse(NextResponse.json(
    { error: { code, message } },
    { status: httpStatusForErrorCode(code) },
  ));
}

export async function withAuthenticatedUser(
  handler: (userId: string, principal: AuthPrincipal) => Promise<NextResponse>,
  options: { request?: Request; scope?: AgentScope; browserOnly?: boolean } = {},
): Promise<NextResponse> {
  try {
    const requestHeaders = options.request?.headers ?? await headers();
    const principal = await resolvePrincipal({ authorization: requestHeaders.get("authorization"), scope: options.scope, browserOnly: options.browserOnly }, {
      session: () => auth(),
      clerkBearer: async (token) => {
        const result = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
        if (typeof result.sub !== "string" || !result.sub) throw new Error("Invalid Clerk session token");
        return { userId: result.sub };
      },
      agent: (token) => getAgentServices().authenticate.execute(token),
    });
    if (options.request) checkBrowserMutation(options.request, principal);
    return privateResponse(await handler(principal.userId, principal));
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return privateResponse(NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status }));
    }
    if (error instanceof RequestBodyError) {
      return privateResponse(NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status }));
    }
    if (error instanceof ZodError) {
      // Human-readable, one issue per line - not the raw issue JSON.
      return errorResponse("INVALID_REQUEST", z.prettifyError(error));
    }
    if (error instanceof DomainError) {
      if (["CREDENTIAL_UNAVAILABLE", "ASSISTANT_UNAVAILABLE", "SCRAPE_FAILED"].includes(error.code)) return errorResponse(error.code, "The requested service is unavailable");
      return errorResponse(error.code, error.message);
    }
    // Provider exceptions may contain upstream bodies or credential-bearing URLs.
    console.error(JSON.stringify({ component: "pointup_api", event: "request_failed", status: 500 }));
    return errorResponse("INTERNAL", "Internal server error");
  }
}

/** Management/approval authority belongs only to a first-party cookie session. */
export function withBrowserAuthenticatedUser(
  request: Request | undefined,
  handler: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  return withAuthenticatedUser(handler, { request, browserOnly: true });
}
