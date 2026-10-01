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

export interface AccessTokenReadModel {
  readonly id: string;
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
    userId: string;
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

  async execute(userId: string): Promise<AccessTokenReadModel[]> {
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

  async execute(userId: string, tokenId: string): Promise<void> {
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
  readonly userId: string;
  readonly scopes: readonly AccessTokenScope[];
  readonly tokenId: string;
}

/** Throttle `lastUsedAt` writes so hot tokens do not hammer the table. */
const TOUCH_INTERVAL_MS = 60_000;

export class AuthenticateAccessToken {
  constructor(
    private readonly tokens: AccessTokenRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(plaintext: string): Promise<AuthenticatedPrincipal> {
    if (!plaintext.startsWith(TOKEN_PREFIX)) throw new AccessTokenInvalidError();
    const token = await this.tokens.findByHash(await hashToken(plaintext));
    const now = this.clock.now();
    if (!token || !isTokenUsable(token, now)) {
      throw new AccessTokenInvalidError();
    }
    if (
      !token.lastUsedAt ||
      now.getTime() - token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS
    ) {
      await this.tokens.update({ ...token, lastUsedAt: now });
    }
    return { userId: token.userId, scopes: token.scopes, tokenId: token.id };
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
