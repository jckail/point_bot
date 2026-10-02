/** Framework-independent credential selection and browser mutation protection. */
import type { AgentScope } from "@pointup/core/agent-contracts";
export type { AgentScope } from "@pointup/core/agent-contracts";
export type AuthPrincipal =
  | { kind: "session"; userId: string; scopes: readonly AgentScope[] }
  | { kind: "clerk-bearer"; userId: string; scopes: readonly AgentScope[] }
  | { kind: "agent"; userId: string; tokenId: string; scopes: readonly AgentScope[] };

export class HttpAuthError extends Error {
  constructor(readonly status: 401 | 403, readonly code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
  }
}
export interface CredentialResolvers {
  session: () => Promise<{ userId: string | null }>;
  clerkBearer: (token: string) => Promise<{ userId: string }>;
  agent: (token: string) => Promise<{ userId: string; tokenId: string; scopes: readonly AgentScope[] }>;
}

export async function resolvePrincipal(input: { authorization: string | null; scope?: AgentScope; browserOnly?: boolean }, resolvers: CredentialResolvers): Promise<AuthPrincipal> {
  const authorization = input.authorization;
  if (input.browserOnly && authorization !== null) throw new HttpAuthError(403, "FORBIDDEN", "Use your signed-in browser session for this action");
  if (authorization !== null) {
    const match = /^Bearer ([^\s,]+)$/i.exec(authorization);
    if (!match) throw new HttpAuthError(401, "UNAUTHENTICATED", "Invalid authorization credential");
    const token = match[1]!;
    if (/^pu_/i.test(token)) {
      // A PAT is never reinterpreted as Clerk auth or allowed to fall back to cookies.
      let identity: Awaited<ReturnType<CredentialResolvers["agent"]>>;
      try { identity = await resolvers.agent(token); }
      catch { throw new HttpAuthError(401, "UNAUTHENTICATED", "Agent token is invalid, expired, or revoked"); }
      if (!input.scope || !identity.scopes.includes(input.scope)) throw new HttpAuthError(403, "FORBIDDEN", "Agent token does not authorize this action");
      return { kind: "agent", ...identity };
    }
    // Header presence is never authority: Clerk can ignore an unrecognized scheme
    // and resolve ambient cookies. Verify the supplied token independently, then
    // retain Clerk middleware/session policy by requiring the same authenticated user.
    let identity: Awaited<ReturnType<CredentialResolvers["clerkBearer"]>>;
    try { identity = await resolvers.clerkBearer(token); }
    catch { throw new HttpAuthError(401, "UNAUTHENTICATED", "Clerk bearer credential is invalid"); }
    const session = await resolvers.session();
    if (!identity.userId || session.userId !== identity.userId) throw new HttpAuthError(401, "UNAUTHENTICATED", "Clerk bearer credential does not match the authenticated session");
    return { kind: "clerk-bearer", userId: identity.userId, scopes: [] };
  }
  const { userId } = await resolvers.session();
  if (!userId) throw new HttpAuthError(401, "UNAUTHENTICATED", "Sign in required");
  return { kind: "session", userId, scopes: [] };
}

export function checkBrowserMutation(request: Request, principal: AuthPrincipal) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  // PAT/Clerk bearer credentials are explicit, not browser ambient cookie authority.
  if (principal.kind === "agent" || principal.kind === "clerk-bearer") return;
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpAuthError(403, "FORBIDDEN", "Use the PointUp website to approve this action");
  }
}
