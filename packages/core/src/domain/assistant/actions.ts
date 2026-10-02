import type { ManualBalanceAccountWitness } from "../loyalty/account-identity-witness";
export { manualBalanceAccountWitnessSchema, type ManualBalanceAccountWitness } from "../loyalty/account-identity-witness";
import type { UserId } from "../shared/ids";
import { z } from "zod";
export { AssistantActionNotFoundError, InvalidAssistantActionError } from "../errors";

const id = z.string().min(1).max(255);
export const manualBalanceProposalSchema = z.object({
  accountId: id,
  providerId: z.string().min(1).max(64),
  providerName: z.string().min(1).max(200),
  points: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.iso.datetime(),
}).strict();
export const tripGoalProposalSchema = z.object({
  title: z.string().trim().min(1).max(120),
  targetPoints: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  targetDate: z.iso.date().nullable(),
  accountIds: z.array(id).max(100),
  accountNames: z.array(z.string().max(200)).max(100),
  notes: z.string().max(2000).nullable(),
}).strict();
export const assistantProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual_balance"), payload: manualBalanceProposalSchema }).strict(),
  z.object({ kind: z.literal("trip_goal"), payload: tripGoalProposalSchema }).strict(),
]);
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;
export const assistantActionStatusSchema = z.enum(["pending", "executing", "succeeded", "rejected", "expired", "failed", "unknown"]);
export type AssistantActionStatus = z.infer<typeof assistantActionStatusSchema>;
export type AssistantAction = AssistantProposal & {
  readonly id: string;
  readonly userId: UserId;
  readonly status: AssistantActionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly result: Record<string, unknown> | null;
  readonly failureCode: string | null;
  readonly executionWitness?: ManualBalanceAccountWitness | null;
};
const dtoMetadata = z.object({
  id,
  status: assistantActionStatusSchema,
  title: z.string(),
  summary: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  result: z.record(z.string(), z.unknown()).nullable(),
  failureCode: z.string().nullable(),
});
export const assistantActionDtoSchema = z.discriminatedUnion("kind", [
  dtoMetadata.extend({ kind: z.literal("manual_balance"), payload: manualBalanceProposalSchema }),
  dtoMetadata.extend({ kind: z.literal("trip_goal"), payload: tripGoalProposalSchema }),
]);
export type AssistantActionDto = z.infer<typeof assistantActionDtoSchema>;
export function toAssistantActionDto(action: AssistantAction): AssistantActionDto {
  const title = action.kind === "manual_balance" ? `Record ${action.payload.providerName} balance` : `Create trip goal: ${action.payload.title}`;
  const summary = action.kind === "manual_balance"
    ? `Save ${action.payload.points} points observed at ${action.payload.capturedAt}. This records a manual observation.`
    : `Create a goal for ${action.payload.targetPoints} points${action.payload.targetDate ? ` by ${action.payload.targetDate}` : ""}.`;
  return assistantActionDtoSchema.parse({ id: action.id, kind: action.kind, payload: action.payload, status: action.status, title, summary, createdAt: action.createdAt.toISOString(), updatedAt: action.updatedAt.toISOString(), expiresAt: action.expiresAt.toISOString(), result: action.result, failureCode: action.failureCode });
}

/** Safe metadata for executions actually transitioned during recovery. */
export type RecoveredAssistantAction = Pick<AssistantAction, "id" | "kind"> & { readonly status: "unknown" };

export interface AssistantActionRepository {
  /** Insert once; a repeated ID returns the existing immutable proposal. */
  insert(action: AssistantAction): Promise<AssistantAction>;
  findOwned(id: string, userId: UserId): Promise<AssistantAction | null>;
  listOwned(userId: UserId, limit: number): Promise<AssistantAction[]>;
  /** Atomically claim an unexpired pending proposal. */
  claim(id: string, userId: UserId, now: Date): Promise<AssistantAction | null>;
  settlePending(id: string, userId: UserId, status: "rejected" | "expired", now: Date): Promise<void>;
  finish(id: string, userId: UserId, status: "succeeded" | "failed" | "unknown", now: Date, result: Record<string, unknown> | null, failureCode: string | null): Promise<void>;
  /** Atomically recover stale executing rows; return only changed rows, with safe audit metadata. */
  expireExecuting(userId: UserId, cutoff: Date, now: Date): Promise<readonly RecoveredAssistantAction[]>;
}

/** Untrusted proposal input. Owner, program labels, status, and expiry are server-bound. */
export const assistantActionProposalRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual_balance"), accountId: id, points: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), capturedAt: z.iso.datetime().nullish() }).strict(),
  z.object({ kind: z.literal("trip_goal"), title: z.string().trim().min(1).max(120), targetPoints: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), targetDate: z.iso.date().nullish(), accountIds: z.array(id).max(100).optional(), notes: z.string().max(2000).nullish() }).strict(),
]);
export type AssistantActionProposalRequest = z.infer<typeof assistantActionProposalRequestSchema>;
