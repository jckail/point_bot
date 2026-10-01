import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

type ClerkHandler = (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response | null | undefined | void> | Response | null | undefined | void;

let clerkHandler: ClerkHandler | undefined;

async function getClerkHandler(): Promise<ClerkHandler> {
  if (!clerkHandler) {
    const { clerkMiddleware, createRouteMatcher } = await import(
      "@clerk/nextjs/server"
    );
    const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);
    clerkHandler = clerkMiddleware(async (auth, request) => {
      if (isProtectedRoute(request)) await auth.protect();
    }) as ClerkHandler;
  }
  return clerkHandler;
}

/**
 * Next.js 16 network boundary (formerly middleware.ts). With
 * AUTH_PROVIDER=clerk (default) Clerk resolves the session here; with
 * AUTH_PROVIDER=dev the proxy is a pass-through and Clerk is never imported.
 * API routes additionally enforce auth in the handler layer
 * (`withAuthenticatedUser`) - never rely on the proxy alone.
 */
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (process.env.AUTH_PROVIDER?.trim().toLowerCase() === "dev") {
    return NextResponse.next();
  }
  return (await getClerkHandler())(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
