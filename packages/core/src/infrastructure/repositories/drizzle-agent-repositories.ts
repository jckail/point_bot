import { desc, eq } from "drizzle-orm";

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
}

export class DrizzleAgentObservationRepository
  implements AgentObservationRepository
{
  constructor(private readonly db: Database) {}

  async insert(observation: AgentObservation) {
    await this.db.insert(agentObservations).values(observation);
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
