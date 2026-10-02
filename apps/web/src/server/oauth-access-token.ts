import { AccessTokenInvalidError, UserId } from "@pointup/core";

/** Unwired until provider resource binding and deployment policy are verified. */
export interface OAuthAccessTokenConfig {
  readonly enabled?: boolean;
  readonly issuer?: string;
  readonly resource?: string;
  readonly allowedClientIds?: readonly string[];
  readonly secretKey?: string;
  readonly jwtKey?: string;
}

export interface OAuthJwtVerificationOptions {
  readonly audience: string;
  readonly headerType: string[];
  readonly clockSkewInMs: number;
  readonly secretKey?: string;
  readonly jwtKey?: string;
}

export interface OAuthAccessTokenDependencies {
  /** Must verify the signature and supplied header types; never decode alone. */
  readonly verifyJwt?: (token: string, options: OAuthJwtVerificationOptions) => Promise<unknown>;
  readonly now?: () => number;
}

/** Deliberately distinct from cookie/session and PAT principals; read-only. */
export interface OAuthReadPrincipal {
  readonly credential: "clerk-oauth";
  readonly userId: UserId;
  readonly scopes: readonly ["portfolio:read"];
  readonly issuer: string;
  readonly resource: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

function httpsIdentifier(value: string | undefined): value is string {
  if (!value || value.trim() !== value || /[\\\s?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && (url.href === value || url.href === `${value}/`);
  } catch { return false; }
}

async function clerkVerifyJwt(token: string, options: OAuthJwtVerificationOptions): Promise<unknown> {
  const { verifyToken } = await import("@clerk/nextjs/server");
  return verifyToken(token, options);
}

/**
 * JWT-only candidate adapter. Installed Clerk verifies OAuth header types and
 * signatures, but permits absent aud and does not compare iss; require both here.
 * Opaque verification exposes no resource binding, so opaque tokens are refused.
 * JWT verification is offline/expiry-bound and does not prove live revocation.
 * Explicit credentials rejected here must never fall back to a cookie or PAT.
 */
export async function verifyOAuthAccessToken(
  token: string,
  config: OAuthAccessTokenConfig = {},
  dependencies: OAuthAccessTokenDependencies = {},
): Promise<OAuthReadPrincipal> {
  try {
    if (config.enabled !== true || !httpsIdentifier(config.issuer) || !httpsIdentifier(config.resource)
        || !config.allowedClientIds?.length || config.allowedClientIds.some(id => !id || id.trim() !== id)
        || !(config.jwtKey || config.secretKey)
        || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error();
    }
    const verified = await (dependencies.verifyJwt ?? clerkVerifyJwt)(token, {
      audience: config.resource,
      headerType: ["at+jwt", "application/at+jwt"],
      clockSkewInMs: 0,
      ...(config.jwtKey ? { jwtKey: config.jwtKey } : { secretKey: config.secretKey }),
    });
    if (!verified || typeof verified !== "object" || Array.isArray(verified)) throw new Error();
    const claims = verified as Record<string, unknown>;
    const now = (dependencies.now ?? Date.now)();
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (claims.iss !== config.issuer || !Array.isArray(audiences) || !audiences.length
        || audiences.some(aud => typeof aud !== "string" || !aud)
        || !audiences.includes(config.resource)
        || typeof claims.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(claims.sub)
        || typeof claims.client_id !== "string" || !config.allowedClientIds.includes(claims.client_id)
        || !Number.isFinite(now) || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp)
        || !Number.isSafeInteger(claims.exp * 1000) || claims.exp * 1000 <= now
        || typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat < 0
        || claims.iat * 1000 > now || claims.iat >= claims.exp
        || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf)
          || claims.nbf < 0 || claims.nbf * 1000 > now))) throw new Error();

    // Match installed Clerk's scp-or-scope convention, refusing inconsistent forms.
    const scp = claims.scp;
    const scope = claims.scope;
    if (scp !== undefined && (!Array.isArray(scp) || scp.some(item => typeof item !== "string" || !item))) throw new Error();
    if (scope !== undefined && typeof scope !== "string") throw new Error();
    const fromString = typeof scope === "string" ? scope.split(" ").filter(Boolean) : undefined;
    const scopes = Array.isArray(scp) ? scp as string[] : fromString;
    if (!scopes?.includes("portfolio:read")
        || (Array.isArray(scp) && fromString && (new Set(scp).size !== new Set(fromString).size
          || scp.some(item => !fromString.includes(item as string))))) throw new Error();

    // Extra granted scopes never acquire write authority in this phase.
    return { credential: "clerk-oauth", userId: UserId.parse(claims.sub), scopes: ["portfolio:read"],
      issuer: config.issuer, resource: config.resource, clientId: claims.client_id, expiresAt: claims.exp * 1000 };
  } catch {
    // SDK failures can include claims or private provider diagnostics.
    throw new AccessTokenInvalidError();
  }
}
