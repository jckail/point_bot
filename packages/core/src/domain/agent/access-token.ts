import { InvalidAccessTokenRequestError } from "../errors";
import { isOneOf } from "../shared/enum";

import { AccessTokenId, type UserId } from "../shared/ids";
/**
 * Personal access tokens let non-browser callers (the MCP server, ChatGPT
 * Actions, scripts, browser agents) act on a user's behalf without sharing
 * their Clerk session. Only a SHA-256 hash is stored; the plaintext is shown
 * exactly once, at creation.
 */

export const ACCESS_TOKEN_SCOPES = [
  /** Read accounts, balances, goals, valuations, advice. */
  "portfolio:read",
  /** Link/edit accounts, goals, valuations (everything except agent write-back). */
  "portfolio:write",
  /** Submit balances observed by an agent. Further gated by per-provider consent. */
  "observations:write",
  /** Revoke agent consents. Granting consent is session-only. Never implied by the others. */
  "consents:manage",
] as const;

export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];

export const TOKEN_PREFIX = "pu_";
const MAX_TTL_DAYS = 365;

export interface AccessToken {
  readonly id: AccessTokenId;
  readonly userId: UserId;
  readonly name: string;
  /** Leading characters of the plaintext, for display ("pu_Ab12…"). */
  readonly displayPrefix: string;
  readonly tokenHash: string;
  readonly scopes: readonly AccessTokenScope[];
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export function isScope(value: string): value is AccessTokenScope {
  return isOneOf(ACCESS_TOKEN_SCOPES, value);
}

export function hasScope(
  scopes: readonly AccessTokenScope[],
  required: AccessTokenScope,
): boolean {
  return scopes.includes(required);
}

export function isTokenUsable(token: AccessToken, now: Date): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

export async function hashToken(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateTokenPlaintext(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${TOKEN_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

export interface NewAccessToken {
  readonly userId: UserId;
  readonly name: string;
  readonly scopes: readonly AccessTokenScope[];
  readonly ttlDays?: number;
  readonly now: Date;
}

/** Builds the aggregate and the one-time plaintext secret. */
export async function createAccessToken(
  input: NewAccessToken,
): Promise<{ token: AccessToken; plaintext: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new InvalidAccessTokenRequestError(
      "Token name must be between 1 and 80 characters",
    );
  }
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) {
    throw new InvalidAccessTokenRequestError("At least one scope is required");
  }
  if (
    input.ttlDays !== undefined &&
    (!Number.isInteger(input.ttlDays) ||
      input.ttlDays < 1 ||
      input.ttlDays > MAX_TTL_DAYS)
  ) {
    throw new InvalidAccessTokenRequestError(
      `Token lifetime must be 1-${MAX_TTL_DAYS} days`,
    );
  }

  const plaintext = generateTokenPlaintext();
  const expiresAt =
    input.ttlDays === undefined
      ? null
      : new Date(input.now.getTime() + input.ttlDays * 86_400_000);

  return {
    plaintext,
    token: {
      id: AccessTokenId.generate(),
      userId: input.userId,
      name,
      displayPrefix: plaintext.slice(0, TOKEN_PREFIX.length + 4),
      tokenHash: await hashToken(plaintext),
      scopes,
      createdAt: input.now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export interface AccessTokenRepository {
  findById(id: AccessTokenId): Promise<AccessToken | null>;
  findByHash(tokenHash: string): Promise<AccessToken | null>;
  findByUserId(userId: UserId): Promise<AccessToken[]>;
  insert(token: AccessToken): Promise<void>;
  update(token: AccessToken): Promise<void>;
  /**
   * Sets only `lastUsedAt` (and only while the token is not revoked), so a
   * background touch can never overwrite a concurrent revocation. Optional:
   * authentication falls back to `update` when an implementation lacks it.
   */
  touchLastUsed?(id: AccessTokenId, at: Date): Promise<void>;
}
