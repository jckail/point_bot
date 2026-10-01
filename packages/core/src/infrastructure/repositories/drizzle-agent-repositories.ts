import { and, desc, eq, isNull, sql } from "drizzle-orm";

import {
  isScope,
  type AccessToken,
  type AccessTokenRepository,
} from "../../domain/agent/access-token";
import type {
  ConsentGrant,
  ConsentGrantRepository,
} from "../../domain/agent/consent";
import type {
  AgentObservation,
  AgentObservationRepository,
  ObservationOutcome,
} from "../../domain/agent/observation";
import type { Database } from "../db/client";
import { accessTokens, agentObservations, consentGrants } from "../db/schema";

type TokenRow = typeof accessTokens.$inferSelect;

function tokenToDomain(row: TokenRow): AccessToken {
  return {
    ...row,
    scopes: row.scopes.split(" ").filter(isScope),
  };
}

function tokenToRow(token: AccessToken): TokenRow {
  return { ...token, scopes: token.scopes.join(" ") };
}

export class DrizzleAccessTokenRepository implements AccessTokenRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string) {
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

  async findByUserId(userId: string) {
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
}

export class DrizzleConsentGrantRepository implements ConsentGrantRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<ConsentGrant | null> {
    const rows = await this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  findByUserId(userId: string): Promise<ConsentGrant[]> {
    return this.db
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.userId, userId))
      .orderBy(desc(consentGrants.grantedAt));
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

  async insert(observation: AgentObservation) {
    await this.db.insert(agentObservations).values(observation);
  }

  async findById(id: string): Promise<AgentObservation | null> {
    const rows = await this.db
      .select()
      .from(agentObservations)
      .where(eq(agentObservations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async transition(
    id: string,
    userId: string,
    from: ObservationOutcome,
    to: ObservationOutcome,
  ): Promise<AgentObservation | null> {
    const rows = await this.db
      .update(agentObservations)
      .set({ outcome: to })
      .where(
        and(
          eq(agentObservations.id, id),
          eq(agentObservations.userId, userId),
          eq(agentObservations.outcome, from),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  findByUserId(userId: string, limit: number): Promise<AgentObservation[]> {
    return this.db
      .select()
      .from(agentObservations)
      .where(eq(agentObservations.userId, userId))
      .orderBy(desc(agentObservations.createdAt))
      .limit(limit);
  }
}
