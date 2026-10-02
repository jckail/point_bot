import { and, desc, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { assistantActions } from "../db/schema";
import { assistantProposalSchema, assistantActionStatusSchema, type AssistantAction, type AssistantActionRepository } from "../../domain/assistant/actions";

function fromRow(row: typeof assistantActions.$inferSelect): AssistantAction {
  const proposal = assistantProposalSchema.parse({ kind: row.kind, payload: row.payload });
  return { ...proposal, id: row.id, userId: row.userId, status: assistantActionStatusSchema.parse(row.status), createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, result: row.result, failureCode: row.failureCode };
}
export class DrizzleAssistantActionRepository implements AssistantActionRepository {
  constructor(private readonly db: Database) {}
  async insert(action: AssistantAction) {
    const rows = await this.db.insert(assistantActions).values(action).onConflictDoNothing().returning();
    if (rows[0]) return fromRow(rows[0]);
    const stored = await this.findOwned(action.id, action.userId);
    if (!stored) throw new Error("Assistant action insertion failed");
    return stored;
  }
  async findOwned(id: string, userId: string) {
    const rows = await this.db.select().from(assistantActions).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId))).limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async listOwned(userId: string, limit: number) {
    const rows = await this.db.select().from(assistantActions).where(eq(assistantActions.userId, userId)).orderBy(desc(assistantActions.createdAt)).limit(limit);
    return rows.map(fromRow);
  }
  async claim(id: string, userId: string, now: Date) {
    const rows = await this.db.update(assistantActions).set({ status: "executing", updatedAt: now }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "pending"), gt(assistantActions.expiresAt, now))).returning();
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async settlePending(id: string, userId: string, status: "rejected" | "expired", now: Date) {
    await this.db.update(assistantActions).set({ status, updatedAt: now }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "pending"), status === "expired" ? lte(assistantActions.expiresAt, now) : gt(assistantActions.expiresAt, now)));
  }
  async finish(id: string, userId: string, status: "succeeded" | "failed" | "unknown", now: Date, result: Record<string, unknown> | null, failureCode: string | null) {
    await this.db.update(assistantActions).set({ status, updatedAt: now, result, failureCode }).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId), eq(assistantActions.status, "executing")));
  }
  async expireExecuting(userId: string, cutoff: Date, now: Date) {
    await this.db.update(assistantActions).set({ status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN", updatedAt: now }).where(and(eq(assistantActions.userId, userId), eq(assistantActions.status, "executing"), lte(assistantActions.updatedAt, cutoff)));
  }
}
