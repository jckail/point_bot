import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../../application/ports";
import type { Database } from "../db/client";
import { activityEvents, agentObservations, agentTokens, balanceSnapshots, loyaltyAccounts, observationConsents } from "../db/schema";
import { LoyaltyAccountNotFoundError } from "../../domain/errors";
import { agentNotFound, consentDenied, invalidAgentInput, observationConflict, observationHoldReason, validateAgentToken, type AgentObservation, type AgentScope, type AgentToken, type ObservationConsent, type PreparedObservation } from "../../domain/agents/models";
import type { AgentObservationRepository, AgentTokenRepository, ObservationConsentRepository } from "../../domain/agents/repositories";

type QueryDb = Pick<Database, "select" | "insert" | "update">;
// Caller time is a lower bound; row-lock waits must also use the current clock.
const currentTime = (clock: Clock, startedAt: Date) => new Date(Math.max(startedAt.getTime(), clock.now().getTime()));
const toToken = (row: typeof agentTokens.$inferSelect): AgentToken => ({ ...row, scopes: row.scopes as AgentScope[] });
async function lockOwnedAccount(db: QueryDb, userId: string, accountId: string, providerId?: string) {
  const [account] = await db.select().from(loyaltyAccounts).where(and(eq(loyaltyAccounts.id, accountId), eq(loyaltyAccounts.userId, userId))).for("update");
  if (!account || account.deletedAt) throw new LoyaltyAccountNotFoundError(accountId);
  if (providerId && account.providerId !== providerId) throw invalidAgentInput("Observation provider does not match the owned account");
  return account;
}
async function persistSnapshot(db: QueryDb, observation: PreparedObservation, now: Date): Promise<string> {
  const id = randomUUID();
  await db.insert(balanceSnapshots).values({ id, loyaltyAccountId: observation.accountId, points: observation.points, source: "manual", capturedAt: observation.capturedAt });
  await db.insert(activityEvents).values({ id: randomUUID(), userId: observation.userId, accountId: observation.accountId, providerId: observation.providerId, type: "balance_manual", summary: `Accepted ${observation.sourceMethod} observation from ${observation.sourceHost}: ${observation.points} points`, occurredAt: now });
  return id;
}
export class DrizzleAgentTokenRepository implements AgentTokenRepository {
  constructor(private readonly db: Database, private readonly clock: Clock = systemClock) {}
  async insert(token: AgentToken) { await this.db.insert(agentTokens).values({ ...token, scopes: [...token.scopes] }); }
  async authenticate(hash: string, now: Date, requiredScope?: AgentScope): Promise<AgentToken | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(agentTokens).where(eq(agentTokens.tokenHash, hash)).for("update");
      if (!row) return null;
      const token = toToken(row);
      const authenticatedAt = currentTime(this.clock, now);
      validateAgentToken(token, authenticatedAt, requiredScope);
      await tx.update(agentTokens).set({ lastUsedAt: authenticatedAt }).where(eq(agentTokens.id, token.id));
      validateAgentToken(token, currentTime(this.clock, now), requiredScope);
      return { ...token, lastUsedAt: authenticatedAt };
    });
  }
  async findByUserId(userId: string) { return (await this.db.select().from(agentTokens).where(eq(agentTokens.userId, userId)).orderBy(desc(agentTokens.createdAt))).map(toToken); }
  async revoke(userId: string, tokenId: string, now: Date) {
    return (await this.db.update(agentTokens).set({ revokedAt: sql`coalesce(${agentTokens.revokedAt}, ${now.toISOString()})` }).where(and(eq(agentTokens.id, tokenId), eq(agentTokens.userId, userId))).returning({ id: agentTokens.id })).length > 0;
  }
}
export class DrizzleObservationConsentRepository implements ObservationConsentRepository {
  constructor(private readonly db: Database) {}
  async grant(consent: ObservationConsent) {
    await this.db.transaction(async (tx) => {
      await lockOwnedAccount(tx, consent.userId, consent.accountId, consent.providerId);
      await tx.update(observationConsents).set({ revokedAt: consent.grantedAt }).where(and(eq(observationConsents.userId, consent.userId), eq(observationConsents.accountId, consent.accountId), isNull(observationConsents.revokedAt)));
      await tx.insert(observationConsents).values(consent);
    });
  }
  async findByUserId(userId: string) { return this.db.select().from(observationConsents).where(eq(observationConsents.userId, userId)).orderBy(desc(observationConsents.grantedAt)); }
  async findActive(userId: string, accountId: string, now: Date) {
    const [consent] = await this.db.select().from(observationConsents).where(and(eq(observationConsents.userId, userId), eq(observationConsents.accountId, accountId), isNull(observationConsents.revokedAt), gt(observationConsents.expiresAt, now))).orderBy(desc(observationConsents.grantedAt)).limit(1);
    return consent ?? null;
  }
  async revoke(userId: string, consentId: string, now: Date) {
    return (await this.db.update(observationConsents).set({ revokedAt: sql`coalesce(${observationConsents.revokedAt}, ${now.toISOString()})` }).where(and(eq(observationConsents.id, consentId), eq(observationConsents.userId, userId))).returning({ id: observationConsents.id })).length > 0;
  }
}
export class DrizzleAgentObservationRepository implements AgentObservationRepository {
  constructor(private readonly db: Database, private readonly clock: Clock = systemClock) {}
  async ingest(observation: PreparedObservation, now: Date): Promise<AgentObservation> {
    return this.db.transaction(async (tx) => {
      const [token] = await tx.select().from(agentTokens).where(and(eq(agentTokens.id, observation.tokenId), eq(agentTokens.userId, observation.userId))).for("update");
      validateAgentToken(token ? toToken(token) : null, currentTime(this.clock, now), "observations:write");
      await lockOwnedAccount(tx, observation.userId, observation.accountId, observation.providerId);
      const [consent] = await tx.select().from(observationConsents).where(and(eq(observationConsents.userId, observation.userId), eq(observationConsents.accountId, observation.accountId), eq(observationConsents.providerId, observation.providerId), isNull(observationConsents.revokedAt), gt(observationConsents.expiresAt, now))).orderBy(desc(observationConsents.grantedAt)).limit(1).for("update");
      const authorize = () => {
        const authorizedAt = currentTime(this.clock, now);
        validateAgentToken(token ? toToken(token) : null, authorizedAt, "observations:write");
        if (!consent || consent.revokedAt || consent.expiresAt.getTime() <= authorizedAt.getTime()) throw consentDenied();
        return authorizedAt;
      };
      authorize();
      const [existing] = await tx.select().from(agentObservations).where(and(eq(agentObservations.userId, observation.userId), eq(agentObservations.id, observation.id))).for("update");
      if (existing) {
        authorize();
        if (existing.payloadHash !== observation.payloadHash) throw observationConflict();
        return existing;
      }
      const [latest] = await tx.select().from(balanceSnapshots).where(eq(balanceSnapshots.loyaltyAccountId, observation.accountId)).orderBy(desc(balanceSnapshots.capturedAt), desc(balanceSnapshots.id)).limit(1);
      const holdReason = observationHoldReason(latest?.points ?? null, observation.points);
      const status = holdReason ? "held" : "accepted";
      // All potentially blocking reads are complete. Check both locked grants at
      // the write boundary, including receipts that do not create a snapshot.
      const authorizedAt = authorize();
      const snapshotId = holdReason ? null : await persistSnapshot(tx, observation, authorizedAt);
      const receiptAt = authorize();
      const record: AgentObservation = { ...observation, consentId: consent!.id, status, holdReason, snapshotId, createdAt: receiptAt, reviewedAt: null };
      await tx.insert(agentObservations).values(record);
      // An insert can itself wait on database locks. Expiry rolls back every write.
      authorize();
      return record;
    }).catch((error: unknown) => {
      let candidate = error;
      for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
        const value = candidate as { code?: string; cause?: unknown };
        if (value.code === "23505") throw observationConflict();
        candidate = value.cause;
      }
      throw error;
    });
  }
  async findByUserId(userId: string, status?: "held"): Promise<AgentObservation[]> {
    return this.db.select().from(agentObservations).where(and(eq(agentObservations.userId, userId), status ? eq(agentObservations.status, status) : undefined)).orderBy(desc(agentObservations.createdAt)).limit(200);
  }
  async findByUserAndId(userId: string, observationId: string): Promise<AgentObservation | null> {
    const [record] = await this.db.select().from(agentObservations).where(and(eq(agentObservations.userId, userId), eq(agentObservations.id, observationId)));
    return record ?? null;
  }
  async review(userId: string, observationId: string, decision: "approve" | "reject", now: Date): Promise<AgentObservation> {
    return this.db.transaction(async (tx) => {
      const [first] = await tx.select().from(agentObservations).where(and(eq(agentObservations.userId, userId), eq(agentObservations.id, observationId)));
      if (!first) throw agentNotFound();
      await lockOwnedAccount(tx, userId, first.accountId, first.providerId);
      const [record] = await tx.select().from(agentObservations).where(and(eq(agentObservations.userId, userId), eq(agentObservations.id, observationId))).for("update");
      if (!record) throw agentNotFound();
      const expectedStatus = decision === "approve" ? "accepted" : "rejected";
      if (record.status !== "held") {
        if (record.reviewedAt && record.status === expectedStatus) return record;
        throw observationConflict();
      }
      const snapshotId = decision === "approve" ? await persistSnapshot(tx, record, now) : null;
      const [updated] = await tx.update(agentObservations).set({ status: expectedStatus, reviewedAt: now, snapshotId }).where(and(eq(agentObservations.userId, userId), eq(agentObservations.id, observationId))).returning();
      return updated!;
    });
  }
}
