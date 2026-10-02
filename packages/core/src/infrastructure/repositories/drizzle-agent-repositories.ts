import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  isScope,
  isTokenUsable,
  type AccessToken,
  type AccessTokenRepository,
} from "../../domain/agent/access-token";
import { isConsentActive } from "../../domain/agent/consent";
import type {
  ConsentGrant,
  ConsentGrantRepository,
} from "../../domain/agent/consent";
import type {
  AgentObservation,
  AgentObservationRepository,
  ObservationOutcome,
  ObservationCredential,
} from "../../domain/agent/observation";
import { AccessTokenInvalidError, ConsentRequiredError, InsufficientScopeError, LoyaltyAccountNotFoundError } from "../../domain/errors";
import { AccessTokenId, ConsentId, LoyaltyAccountId, ObservationId, UserId } from "../../domain/shared/ids";
import type { Database } from "../db/client";
import { accessTokens, agentObservations, consentGrants, loyaltyAccounts } from "../db/schema";
import { DrizzleLoyaltyAccountRepository } from "./drizzle-loyalty-account-repository";

type TokenRow = typeof accessTokens.$inferSelect;

function tokenToDomain(row: TokenRow): AccessToken {
  return {
    ...row,
    id: AccessTokenId.parse(row.id),
    userId: UserId.parse(row.userId),
    scopes: row.scopes.split(" ").filter(isScope),
  };
}

function tokenToRow(token: AccessToken): TokenRow {
  return { ...token, scopes: token.scopes.join(" ") };
}

type ConsentRow = typeof consentGrants.$inferSelect;

function consentToDomain(row: ConsentRow): ConsentGrant {
  return {
    ...row,
    id: ConsentId.parse(row.id),
    userId: UserId.parse(row.userId),
  };
}

type ObservationRow = typeof agentObservations.$inferSelect;

function observationToDomain(row: ObservationRow): AgentObservation {
  if (row.provenanceVersion !== 0 && row.provenanceVersion !== 1) throw new Error("Invalid observation provenance version");
  return {
    ...row,
    provenanceVersion: row.provenanceVersion,
    id: ObservationId.parse(row.id),
    userId: UserId.parse(row.userId),
    accountId: LoyaltyAccountId.parse(row.accountId),
  };
}

export class DrizzleAccessTokenRepository implements AccessTokenRepository {
  constructor(private readonly db: Database) {}

  async findById(id: AccessTokenId) {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.id, id))
      .limit(1);
    return rows[0] ? tokenToDomain(rows[0]) : null;
  }

  async findByHash(tokenHash: string) {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? tokenToDomain(rows[0]) : null;
  }

  async findByUserId(userId: UserId) {
    const rows = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, userId))
      .orderBy(desc(accessTokens.createdAt));
    return rows.map(tokenToDomain);
  }

  async insert(token: AccessToken) {
    await this.db.insert(accessTokens).values(tokenToRow(token));
  }

  async update(token: AccessToken) {
    await this.db
      .update(accessTokens)
      .set(tokenToRow(token))
      .where(eq(accessTokens.id, token.id));
  }

  async touchLastUsed(id: AccessTokenId, at: Date) {
    await this.db
      .update(accessTokens)
      .set({ lastUsedAt: at })
      .where(and(eq(accessTokens.id, id), isNull(accessTokens.revokedAt)));
  }
}

export class DrizzleConsentGrantRepository implements ConsentGrantRepository {
  constructor(private readonly db: Database) {}

  async findById(id: ConsentId): Promise<ConsentGrant | null> {
    const rows = await this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.id, id))
      .limit(1);
    return rows[0] ? consentToDomain(rows[0]) : null;
  }

  async findByUserId(userId: UserId): Promise<ConsentGrant[]> {
    const rows = await this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.userId, userId))
      .orderBy(desc(consentGrants.grantedAt));
    return rows.map(consentToDomain);
  }

  async insert(consent: ConsentGrant) {
    await this.db.insert(consentGrants).values(consent);
  }

  async update(consent: ConsentGrant) {
    await this.db
      .update(consentGrants)
      .set(consent)
      .where(eq(consentGrants.id, consent.id));
  }

  async replaceActive(consent: ConsentGrant, now: Date) {
    // Grants for one (user, provider) are serialized with a transaction-scoped
    // advisory lock, so a concurrent grant waits, then revokes the winner's
    // committed row instead of racing it to the partial unique index. The
    // retry on a unique violation remains only as a belt-and-braces guard.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`consent:${consent.userId}:${consent.providerId}`}, 0))`,
          );
          await tx
            .update(consentGrants)
            .set({ revokedAt: now })
            .where(
              and(
                eq(consentGrants.userId, consent.userId),
                eq(consentGrants.providerId, consent.providerId),
                isNull(consentGrants.revokedAt),
              ),
            );
          await tx.insert(consentGrants).values(consent);
        });
        return;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 4) throw error;
      }
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class DrizzleAgentObservationRepository
  implements AgentObservationRepository
{
  constructor(private readonly db: Database) {}

  async lockSubmission(input: {
    userId: UserId;
    providerId: string;
    credential?: ObservationCredential;
    captureId?: string;
    canLinkAccount?: boolean;
  }, now: () => Date) {
    // An owner/capture key serializes replay even across different providers.
    // All these locks require the production composition's ambient atomic UOW.
    if (input.captureId) await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`observation-capture:${input.userId}:${input.captureId}`}, 0))`);
    let token: AccessToken | null = null;
    if (input.credential?.kind === "personal_access_token") {
      const [row] = await this.db.select().from(accessTokens).where(and(
        eq(accessTokens.id, input.credential.tokenId), eq(accessTokens.userId, input.userId),
      )).for("update");
      token = row ? tokenToDomain(row) : null;
      if (!token) throw new AccessTokenInvalidError();
    }
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`consent:${input.userId}:${input.providerId}`}, 0))`);
    const [accountRow] = await this.db.select().from(loyaltyAccounts).where(and(
      eq(loyaltyAccounts.userId, input.userId), eq(loyaltyAccounts.providerId, input.providerId),
    )).for("update");
    const account = accountRow
      ? await new DrizzleLoyaltyAccountRepository(this.db).findById(LoyaltyAccountId.parse(accountRow.id))
      : null;
    const [consentRow] = await this.db.select().from(consentGrants).where(and(
      eq(consentGrants.userId, input.userId), eq(consentGrants.providerId, input.providerId), isNull(consentGrants.revokedAt),
    )).orderBy(desc(consentGrants.grantedAt)).limit(1).for("update");
    if (!consentRow) throw new ConsentRequiredError(input.providerId);
    const consent = consentToDomain(consentRow);
    const assertAuthorized = () => {
      const current = now();
      if (token) {
        if (!isTokenUsable(token, current)) throw new AccessTokenInvalidError();
        if (!token.scopes.includes("observations:write")) throw new InsufficientScopeError("observations:write");
        if (!account && input.canLinkAccount && !token.scopes.includes("portfolio:write")) throw new InsufficientScopeError("portfolio:write");
      }
      if (!isConsentActive(consent, current)) throw new ConsentRequiredError(input.providerId);
      if (account && (account.userId !== input.userId || account.providerId !== input.providerId || account.deletedAt)) {
        throw new LoyaltyAccountNotFoundError(input.providerId);
      }
    };
    assertAuthorized();
    return { consent, account, assertAuthorized };
  }

  async findByCaptureId(userId: UserId, captureId: string): Promise<AgentObservation | null> {
    const [row] = await this.db.select().from(agentObservations).where(and(
      eq(agentObservations.userId, userId), eq(agentObservations.captureId, captureId),
    )).limit(1);
    return row ? observationToDomain(row) : null;
  }

  async lockReview(id: ObservationId, userId: UserId): Promise<AgentObservation | null> {
    const [initial] = await this.db.select().from(agentObservations).where(and(
      eq(agentObservations.id, id), eq(agentObservations.userId, userId),
    )).limit(1);
    if (!initial) return null;
    // Same provider -> account -> receipt ordering as capture and balance writers.
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`consent:${userId}:${initial.providerId}`}, 0))`);
    await this.db.select().from(loyaltyAccounts).where(and(
      eq(loyaltyAccounts.id, initial.accountId), eq(loyaltyAccounts.userId, userId), eq(loyaltyAccounts.providerId, initial.providerId),
    )).for("update");
    const [row] = await this.db.select().from(agentObservations).where(and(
      eq(agentObservations.id, id), eq(agentObservations.userId, userId),
    )).for("update");
    return row ? observationToDomain(row) : null;
  }

  async insert(observation: AgentObservation) {
    await this.db.insert(agentObservations).values(observation);
  }

  async findById(id: ObservationId): Promise<AgentObservation | null> {
    const rows = await this.db
      .select()
      .from(agentObservations)
      .where(eq(agentObservations.id, id))
      .limit(1);
    return rows[0] ? observationToDomain(rows[0]) : null;
  }

  async transition(
    id: ObservationId,
    userId: UserId,
    from: ObservationOutcome,
    to: ObservationOutcome,
    metadata?: { reviewedAt: Date; reviewDecision: "confirm" | "reject"; recordedSnapshotId?: string },
  ): Promise<AgentObservation | null> {
    const rows = await this.db
      .update(agentObservations)
      .set({ outcome: to, ...metadata })
      .where(
        and(
          eq(agentObservations.id, id),
          eq(agentObservations.userId, userId),
          eq(agentObservations.outcome, from),
        ),
      )
      .returning();
    return rows[0] ? observationToDomain(rows[0]) : null;
  }

  async findByUserId(
    userId: UserId,
    limit: number,
  ): Promise<AgentObservation[]> {
    const rows = await this.db
      .select()
      .from(agentObservations)
      .where(eq(agentObservations.userId, userId))
      .orderBy(desc(agentObservations.createdAt))
      .limit(limit);
    return rows.map(observationToDomain);
  }
}
