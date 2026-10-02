import { AccessTokenInvalidError, DEFAULT_DEV_ALLOWED_HOSTS, InsufficientScopeError, isDevHostAllowed, UserId } from "@pointup/core";
import { headers } from "next/headers";

import { env } from "@/env";
import type { Principal } from "./access-policy";

/**
 * Session identity for the web surface, behind one seam so the rest of the app
 * never imports Clerk directly:
 *
 * - AUTH_PROVIDER=clerk (default): Clerk resolves the signed-in user. Clerk is
 *   imported lazily, so dev mode never loads it (and needs no keys).
 * - AUTH_PROVIDER=dev: a fixed seeded user (DEV_USER_ID) with no sign-in, only
 *   for loopback/allow-listed Host headers. The principal is still a "session"
 *   one, so CSRF, session-only routes and consent rules apply unchanged.
 *
 * Bearer `pu_` tokens are resolved separately (http.ts) and work in both modes.
 */

export function isDevAuth(): boolean {
  return env.AUTH_PROVIDER === "dev";
}

function devAllowedHosts(): readonly string[] {
  const raw = env.DEV_AUTH_ALLOWED_HOSTS;
  return raw
    ? raw.split(",").map((h) => h.trim()).filter(Boolean)
    : DEFAULT_DEV_ALLOWED_HOSTS;
}

async function devUserId(): Promise<UserId | null> {
  const host = (await headers()).get("host");
  return isDevHostAllowed(host, devAllowedHosts())
    ? UserId.parse(env.DEV_USER_ID)
    : null;
}

/** The signed-in (or dev) user's id, or null when there is no session. */
export async function getSessionUserId(): Promise<UserId | null> {
  if (isDevAuth()) return devUserId();
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return userId ? UserId.parse(userId) : null;
}

/** Explicit credentials never fall back to an ambient Clerk or dev session. */
export async function resolveRequestPrincipal(
  options: { readonly sessionOnly?: boolean },
  authenticateToken: (token: string) => Promise<Principal>,
): Promise<Principal | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization === null) {
    const userId = await getSessionUserId();
    return userId ? { userId, scopes: "session" } : null;
  }
  // Token management and consent approval require browser cookie authority,
  // even when a valid bearer belongs to the same user as the ambient session.
  if (options.sessionOnly) throw new InsufficientScopeError("session");
  const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
  if (!match) throw new AccessTokenInvalidError();
  const token = match[1]!;
  if (/^pu_/i.test(token)) return authenticateToken(token);
  if (isDevAuth()) throw new AccessTokenInvalidError();
  const { auth, verifyToken } = await import("@clerk/nextjs/server");
  let subject: string;
  try {
    const verified = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    if (typeof verified.sub !== "string" || !verified.sub) throw new Error("Missing subject");
    subject = verified.sub;
  } catch { throw new AccessTokenInvalidError(); }
  const { userId } = await auth();
  // Independent verification prevents Clerk's ignored-header cookie fallback;
  // agreement retains the middleware's session policy for verified JWTs.
  if (userId !== subject) throw new AccessTokenInvalidError();
  return { userId: UserId.parse(subject), scopes: "session", credential: "clerk-bearer" };
}

export interface SessionUser {
  readonly firstName: string | null;
}

/** Display details for greetings; never required for authorization. */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDevAuth()) {
    return (await devUserId()) ? { firstName: "dev user" } : null;
  }
  const { currentUser } = await import("@clerk/nextjs/server");
  const user = await currentUser();
  return user ? { firstName: user.firstName } : null;
}
