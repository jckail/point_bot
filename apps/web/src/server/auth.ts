import { DEFAULT_DEV_ALLOWED_HOSTS, isDevHostAllowed } from "@pointup/core";
import { headers } from "next/headers";

import { env } from "@/env";

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

async function devUserId(): Promise<string | null> {
  const host = (await headers()).get("host");
  return isDevHostAllowed(host, devAllowedHosts()) ? env.DEV_USER_ID : null;
}

/** The signed-in (or dev) user's id, or null when there is no session. */
export async function getSessionUserId(): Promise<string | null> {
  if (isDevAuth()) return devUserId();
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return userId ?? null;
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
