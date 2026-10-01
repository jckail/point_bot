import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import {
  AccessTokenInvalidError,
  AccessTokenNotFoundError,
  InsufficientScopeError,
} from "../../domain/errors";
import {
  createAccessToken,
  hasScope,
  hashToken,
  isTokenUsable,
  TOKEN_PREFIX,
  type AccessToken,
  type AccessTokenRepository,
  type AccessTokenScope,
} from "../../domain/agent/access-token";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

import type { AccessTokenId, UserId } from "../../domain/shared/ids";
export interface AccessTokenReadModel {
  readonly id: AccessTokenId;
  readonly name: string;
  readonly displayPrefix: string;
  readonly scopes: readonly AccessTokenScope[];
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export function toAccessTokenReadModel(
  token: AccessToken,
): AccessTokenReadModel {
  return {
    id: token.id,
    name: token.name,
    displayPrefix: token.displayPrefix,
    scopes: token.scopes,
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
  };
}

export class IssueAccessToken {
  constructor(
    private readonly tokens: AccessTokenRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  /** The plaintext is returned once and can never be recovered afterwards. */
  async execute(input: {
    userId: UserId;
    name: string;
    scopes: readonly AccessTokenScope[];
    ttlDays?: number;
  }): Promise<{ token: AccessTokenReadModel; plaintext: string }> {
    const { token, plaintext } = await createAccessToken({
      ...input,
      now: this.clock.now(),
    });
    await this.eventing.unitOfWork.run(async () => {
      await this.tokens.insert(token);
      await this.eventing.publisher.publish([
        createDomainEvent("token.issued", {
          userId: token.userId,
          aggregateId: token.id,
          occurredAt: token.createdAt,
          // Scope names and expiry only: never the name, prefix, or hash.
          payload: {
            scopes: [...token.scopes],
            expiresAt: token.expiresAt?.toISOString() ?? null,
          },
        }),
      ]);
    });
    return { token: toAccessTokenReadModel(token), plaintext };
  }
}

export class ListAccessTokens {
  constructor(private readonly tokens: AccessTokenRepository) {}

  async execute(userId: UserId): Promise<AccessTokenReadModel[]> {
    return (await this.tokens.findByUserId(userId)).map(
      toAccessTokenReadModel,
    );
  }
}

export class RevokeAccessToken {
  constructor(
    private readonly tokens: AccessTokenRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(userId: UserId, tokenId: AccessTokenId): Promise<void> {
    const token = await this.tokens.findById(tokenId);
    if (!token || token.userId !== userId) {
      throw new AccessTokenNotFoundError(tokenId);
    }
    if (token.revokedAt) return;
    const now = this.clock.now();
    await this.eventing.unitOfWork.run(async () => {
      await this.tokens.update({ ...token, revokedAt: now });
      await this.eventing.publisher.publish([
        createDomainEvent("token.revoked", {
          userId,
          aggregateId: token.id,
          occurredAt: now,
          payload: {},
        }),
      ]);
    });
  }
}

export interface AuthenticatedPrincipal {
  readonly userId: UserId;
  readonly scopes: readonly AccessTokenScope[];
  readonly tokenId: AccessTokenId;
}

/** Default throttle for `lastUsedAt` writes (`AUTH_TOUCH_INTERVAL_SECONDS`, 300 s). */
export const DEFAULT_TOUCH_INTERVAL_MS = 300_000;

export interface AuthenticateAccessTokenOptions {
  /** Minimum gap between `lastUsedAt` writes for one token. */
  readonly touchIntervalMs?: number;
  /**
   * Called when the background `lastUsedAt` write fails. The failure never
   * affects the authentication result (it is bookkeeping); use this hook for a
   * log line or a metric. Must not throw.
   */
  readonly onTouchError?: (error: unknown) => void;
}

export class AuthenticateAccessToken {
  private readonly touchIntervalMs: number;
  private readonly onTouchError: (error: unknown) => void;

  constructor(
    private readonly tokens: AccessTokenRepository,
    private readonly clock: Clock = systemClock,
    options: AuthenticateAccessTokenOptions = {},
  ) {
    this.touchIntervalMs = options.touchIntervalMs ?? DEFAULT_TOUCH_INTERVAL_MS;
    this.onTouchError = options.onTouchError ?? (() => {});
  }

  async execute(plaintext: string): Promise<AuthenticatedPrincipal> {
    if (!plaintext.startsWith(TOKEN_PREFIX)) throw new AccessTokenInvalidError();
    const token = await this.tokens.findByHash(await hashToken(plaintext));
    const now = this.clock.now();
    if (!token || !isTokenUsable(token, now)) {
      throw new AccessTokenInvalidError();
    }
    if (
      !token.lastUsedAt ||
      now.getTime() - token.lastUsedAt.getTime() > this.touchIntervalMs
    ) {
      this.touch(token, now);
    }
    return { userId: token.userId, scopes: token.scopes, tokenId: token.id };
  }

  /**
   * Fire-and-forget: the request must not wait for (or fail on) a bookkeeping
   * write. Prefers the narrow `touchLastUsed` (one column, never resurrects a
   * concurrently revoked token); falls back to a full-row update.
   */
  private touch(token: AccessToken, now: Date): void {
    try {
      const write = this.tokens.touchLastUsed
        ? this.tokens.touchLastUsed(token.id, now)
        : this.tokens.update({ ...token, lastUsedAt: now });
      void Promise.resolve(write).catch((error: unknown) => this.safeReport(error));
    } catch (error) {
      this.safeReport(error);
    }
  }

  private safeReport(error: unknown): void {
    try {
      this.onTouchError(error);
    } catch {
      /* a reporting hook must never break authentication */
    }
  }
}

/** Guard used by HTTP routes: session users pass; tokens need the scope. */
export function requireScope(
  scopes: readonly AccessTokenScope[] | "session",
  required: AccessTokenScope,
): void {
  if (scopes === "session") return;
  if (!hasScope(scopes, required)) throw new InsufficientScopeError(required);
}
