import type { UserId } from "@pointup/core";
import { tool } from "@openai/agents";
import { z } from "zod";
import type { AssistantActionDto, ManageAssistantActions } from "@pointup/core/assistant-actions";
import { withinDeadline } from "./deadline";
import type { AgentUseCases, Observation } from "./index";

export function createPortfolioTools(useCases: AgentUseCases, userId: UserId, signal: AbortSignal, emit: (event: Omit<Observation, "requestId" | "mode" | "sdkTraceId">) => void, proposals?: { service: Pick<ManageAssistantActions, "proposeManualBalance" | "proposeTripGoal">; requestId: string; onProposed: (action: AssistantActionDto) => void }) {
  const execute = async (name: string, query: () => Promise<unknown>) => {
    const start = performance.now();
    signal.throwIfAborted();
    try {
      const data = await withinDeadline(query(), signal);
      signal.throwIfAborted();
      const serialized = JSON.stringify(data);
      if (serialized.length > 64_000) throw new Error("Tool output limit");
      emit({ event: "tool_completed", tool: name, status: "success", durationMs: Math.round(performance.now() - start) });
      return serialized;
    } catch {
      emit({ event: "tool_completed", tool: name, status: signal.aborted ? "cancelled" : "failed", durationMs: Math.round(performance.now() - start) });
      throw new Error("Portfolio data could not be loaded.");
    }
  };
  const tools = [
    tool({ name: "portfolio_summary", description: "Read current totals and estimated value for the signed-in user's portfolio.", parameters: z.object({}).strict(), execute: () => execute("portfolio_summary", () => useCases.getPortfolioSummary.execute(userId)) }),
    tool({ name: "loyalty_balances", description: "Read program balances, capture times, and projected expiry for at most 50 accounts. No membership numbers or credentials are returned.", parameters: z.object({}).strict(), execute: () => execute("loyalty_balances", async () => {
      const accounts = await useCases.listLoyaltyAccounts.execute(userId);
      return { totalAccounts: accounts.length, accounts: accounts.slice(0, 50).map(account => ({ accountId: account.id, provider: account.provider.displayName, currency: account.provider.pointsCurrency, points: account.latestBalance?.points ?? null, capturedAt: account.latestBalance?.capturedAt ?? null, expiresAt: account.expiresAt, estimatedValueCents: account.estimatedValueCents })) };
    }) }),
    tool({ name: "trip_goals", description: "Read trip goal progress for at most 30 goals. Notes and account identifiers are excluded.", parameters: z.object({}).strict(), execute: () => execute("trip_goals", async () => {
      const goals = await useCases.listTripGoals.execute(userId);
      return { totalGoals: goals.length, goals: goals.slice(0, 30).map(goal => ({ title: goal.title, targetPoints: goal.targetPoints, targetDate: goal.targetDate, status: goal.status, currentPoints: goal.currentPoints, remainingPoints: goal.remainingPoints, percentComplete: goal.percentComplete })) };
    }) }),
    tool({ name: "value_advice", description: "Read ranked editorial transfer and redemption estimates. These are not live award search or booking quotes.", parameters: z.object({}).strict(), execute: () => execute("value_advice", async () => {
      const advice = await useCases.getValueAdvice.execute(userId);
      return { transfers: advice.transfers.slice(0, 10), deals: advice.deals.slice(0, 10) };
    }) }),
  ];
  if (!proposals) return tools;
  let proposedCount = 0;
  const observedAt = new Date().toISOString();
  const propose = async (name: string, operation: () => Promise<AssistantActionDto>) => {
    if (++proposedCount > 5) throw new Error("At most five reviewed proposals are allowed in one chat request.");
    return execute(name, async () => {
      const action = await operation();
      proposals.onProposed(action);
      return { action, requiresBrowserApproval: true, reviewPath: "/dashboard/agents#review-actions" };
    });
  };
  return [...tools,
    tool({ name: "propose_manual_balance", description: "Propose an exact manual balance observation for an owned account. Does not execute a write. User must review and approve the persisted proposal in PointUp review panel.", parameters: z.object({ accountId: z.string().min(1).max(255), points: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), capturedAt: z.iso.datetime().nullable() }).strict(), execute: args => propose("propose_manual_balance", () => proposals.service.proposeManualBalance({ ...args, capturedAt: args.capturedAt ?? observedAt, userId, requestId: proposals.requestId })) }),
    tool({ name: "propose_trip_goal", description: "Propose an exact trip goal for browser review. Does not execute a write; account IDs must belong to the signed-in user.", parameters: z.object({ title: z.string().min(1).max(120), targetPoints: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), targetDate: z.iso.date().nullable(), accountIds: z.array(z.string().min(1).max(255)).max(100), notes: z.string().max(2000).nullable() }).strict(), execute: args => propose("propose_trip_goal", () => proposals.service.proposeTripGoal({ ...args, userId, requestId: proposals.requestId })) }),
  ];
}
