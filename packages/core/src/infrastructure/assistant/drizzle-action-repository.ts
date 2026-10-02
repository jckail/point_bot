import { UserId } from "../../domain/shared/ids";
import { systemClock, type Clock } from "../../application/ports";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { assistantActions } from "../db/schema";
import { assistantProposalSchema, assistantActionStatusSchema, manualBalanceAccountWitnessSchema, type AssistantAction, type AssistantActionRepository } from "../../domain/assistant/actions";

function fromRow(row: typeof assistantActions.$inferSelect): AssistantAction {
  const { __pointupExecutionWitness, ...payload } = row.payload;
  const proposal = assistantProposalSchema.parse({ kind: row.kind, payload });
  const witness = manualBalanceAccountWitnessSchema.safeParse(__pointupExecutionWitness);
  return { ...proposal, executionWitness: proposal.kind === "manual_balance" && witness.success ? witness.data : null, id: row.id, userId: UserId.parse(row.userId), status: assistantActionStatusSchema.parse(row.status), createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, result: row.result, failureCode: row.failureCode };
}
export class DrizzleAssistantActionRepository implements AssistantActionRepository {
  constructor(private readonly db: Database, private readonly clock: Clock = systemClock) {}
  async insert(action: AssistantAction) {
    const { executionWitness, ...record } = action;
    const payload = action.kind === "manual_balance" && executionWitness
      ? { ...action.payload, __pointupExecutionWitness: manualBalanceAccountWitnessSchema.parse(executionWitness) }
      : action.payload;
    const rows = await this.db.insert(assistantActions).values({ ...record, payload }).onConflictDoNothing().returning();
    if (rows[0]) return fromRow(rows[0]);
    const stored = await this.findOwned(action.id, action.userId);
    if (!stored) throw new Error("Assistant action insertion failed");
    return stored;
  }
  async findOwned(id: string, userId: UserId) {
    const rows = await this.db.select().from(assistantActions).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId))).limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async listOwned(userId: UserId, limit: number) {
    const rows = await this.db.select().from(assistantActions).where(eq(assistantActions.userId, userId)).orderBy(desc(assistantActions.createdAt)).limit(limit);
    return rows.map(fromRow);
  }
  async claim(id: string, userId: UserId, now: Date) {
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(assistantActions).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId))).for("update");
      const claimedAt = new Date(Math.max(now.getTime(), this.clock.now().getTime()));
      if (!row || row.status !== "pending") return null;
      if (row.expiresAt <= claimedAt) {
        await tx.update(assistantActions).set({ status: "expired", updatedAt: claimedAt }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "pending")));
        return null;
      }
      const rows = await tx.update(assistantActions).set({ status: "executing", updatedAt: claimedAt }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "pending"), gt(assistantActions.expiresAt, claimedAt))).returning();
      return rows[0] ? fromRow(rows[0]) : null;
    });
  }
  async settlePending(id: string, userId: UserId, status: "rejected" | "expired", now: Date) {
    await this.db.update(assistantActions).set({ status, updatedAt: now }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "pending"), status === "expired" ? lte(assistantActions.expiresAt, now) : gt(assistantActions.expiresAt, now)));
  }
  async finish(id: string, userId: UserId, status: "succeeded" | "failed" | "unknown", now: Date, result: Record<string, unknown> | null, failureCode: string | null) {
    const rows = await this.db.update(assistantActions).set({ status, updatedAt: now, result, failureCode }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "executing"))).returning({ id: assistantActions.id });
    if (rows.length !== 1) throw new Error("Assistant action execution claim is no longer available.");
  }
  async expireExecuting(userId: UserId, cutoff: Date, now: Date) {
    const rows = await this.db.update(assistantActions).set({ status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN", updatedAt: now }).where(and(eq(assistantActions.userId, userId), eq(assistantActions.status, "executing"), lte(assistantActions.updatedAt, cutoff))).returning({ id: assistantActions.id, kind: assistantActions.kind });
    return rows.map(row => ({ ...row, status: "unknown" as const }));
  }
}
