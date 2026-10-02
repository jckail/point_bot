import { z } from "zod";
import type { AssistantActionDto } from "@pointup/core/assistant-actions";
const date = z.string().datetime({ offset: true });
const base = {
  id: z.string().min(1), status: z.enum(["pending", "executing", "succeeded", "rejected", "expired", "failed", "unknown"]),
  title: z.string(), summary: z.string(), createdAt: date, expiresAt: date, updatedAt: date,
  result: z.record(z.string(), z.unknown()).nullable(), failureCode: z.string().nullable(),
};
export const reviewedActionSchema: z.ZodType<AssistantActionDto> = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("manual_balance"), payload: z.object({ accountId: z.string().min(1), providerName: z.string(), providerId: z.string(), points: z.number().int().nonnegative().safe(), capturedAt: date }) }),
  z.object({ ...base, kind: z.literal("trip_goal"), payload: z.object({ title: z.string().min(1), targetPoints: z.number().int().positive().safe(), targetDate: z.iso.date().nullable(), accountIds: z.array(z.string()), accountNames: z.array(z.string()), notes: z.string().nullable() }) }),
]);
export type ReviewedAction = AssistantActionDto;
export function canReviewAction(action: ReviewedAction, now: number): boolean {
  return action.status === "pending" && new Date(action.expiresAt).getTime() > now;
}
export function reviewActionDetails(action: ReviewedAction): { label: string; value: string }[] {
  if (action.kind === "manual_balance") return [
    { label: "Program", value: action.payload.providerName },
    { label: "Account", value: action.payload.accountId },
    { label: "New balance", value: `${action.payload.points.toLocaleString("en-US")} points` },
    { label: "Captured at", value: action.payload.capturedAt },
  ];
  return [
    { label: "Goal title", value: action.payload.title },
    { label: "Target", value: `${action.payload.targetPoints.toLocaleString("en-US")} points` },
    { label: "Target date", value: action.payload.targetDate ?? "No target date" },
    { label: "Programs counted", value: action.payload.accountNames.join(", ") || "No programs selected" },
    { label: "Account references", value: action.payload.accountIds.join(", ") || "None" },
    { label: "Notes", value: action.payload.notes ?? "No notes" },
  ];
}
