import { LoyaltyAccountId, type UserId } from "../../domain/shared/ids";
import type { UnitOfWork } from "../events/ports";
import { createHash } from "node:crypto";
import { createTripGoal } from "../../domain/loyalty/trip-goal";
import { assistantProposalSchema, AssistantActionNotFoundError, InvalidAssistantActionError, toAssistantActionDto, type AssistantAction, type AssistantActionRepository, type AssistantProposal } from "../../domain/assistant/actions";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { GetLoyaltyAccount } from "../loyalty/get-loyalty-account";
import type { RecordManualBalance } from "../loyalty/record-manual-balance";
import type { CreateTripGoal } from "../loyalty/create-trip-goal";
import { createAccountIdentityWitness, matchesAccountIdentityWitness, type AccountIdentityPreconditionError } from "../loyalty/account-identity-witness";
import type { ManualBalanceAccountWitness } from "../../domain/loyalty/account-identity-witness";

export type ActionUseCases = {
  getLoyaltyAccount: Pick<GetLoyaltyAccount, "execute">;
  recordManualBalance: Pick<RecordManualBalance, "execute">;
  createTripGoal: Pick<CreateTripGoal, "execute">;
};
export type ActionAudit = (event: { event: "assistant_action"; actionId: string; kind: AssistantAction["kind"]; status: AssistantAction["status"]; durationMs?: number }) => void;
const PROPOSAL_TTL_MS = 15 * 60_000;
const EXECUTION_LEASE_MS = 5 * 60_000;

/** Persisted proposals never execute until an owner confirms the stored values. */
export class ManageAssistantActions {
  constructor(private readonly repository: AssistantActionRepository, private readonly useCases: ActionUseCases, private readonly clock: Clock = systemClock, private readonly audit: ActionAudit = () => {}, private readonly unitOfWork?: UnitOfWork) {}

  private record(action: AssistantAction, durationMs?: number) {
    try { this.audit({ event: "assistant_action", actionId: action.id, kind: action.kind, status: action.status, ...(durationMs === undefined ? {} : { durationMs }) }); } catch { /* telemetry cannot change mutation outcome */ }
  }

  private async refresh(userId: UserId) {
    const now = this.clock.now();
    await this.repository.expireExecuting(userId, new Date(now.getTime() - EXECUTION_LEASE_MS), now);
  }

  async list(userId: UserId) {
    await this.refresh(userId);
    const now = this.clock.now();
    const actions = await this.repository.listOwned(userId, 50);
    for (const action of actions) {
      if (action.status === "pending" && action.expiresAt <= now) await this.repository.settlePending(action.id, userId, "expired", now);
    }
    return (await this.repository.listOwned(userId, 50)).map(toAssistantActionDto);
  }

  async proposeManualBalance(input: { userId: UserId; requestId: string; accountId: string; points: number; capturedAt?: string | null }) {
    const account = await this.useCases.getLoyaltyAccount.execute(input.userId, LoyaltyAccountId.parse(input.accountId));
    const capturedAt = input.capturedAt ?? this.clock.now().toISOString();
    const proposal = assistantProposalSchema.parse({ kind: "manual_balance", payload: { accountId: account.id, providerId: account.provider.id, providerName: account.provider.displayName, points: input.points, capturedAt } });
    if (new Date(capturedAt) > this.clock.now()) throw new InvalidAssistantActionError("Observation time cannot be in the future.");
    const witness = createAccountIdentityWitness({ id: account.id, userId: input.userId, providerId: account.provider.id, membershipNumber: account.membershipNumber });
    return this.insert(input.userId, input.requestId, proposal, witness);
  }

  async proposeTripGoal(input: { userId: UserId; requestId: string; title: string; targetPoints: number; targetDate?: string | null; accountIds?: readonly string[]; notes?: string | null }) {
    // Review the same canonical values that the existing mutation use case persists.
    const canonical = createTripGoal({ userId: input.userId, title: input.title, targetPoints: input.targetPoints, targetDate: input.targetDate, accountIds: input.accountIds?.map(value => LoyaltyAccountId.parse(value)), notes: input.notes, now: this.clock.now() });
    const accountIds = canonical.accountIds;
    if (accountIds.length > 100) throw new InvalidAssistantActionError();
    const accounts = await Promise.all(accountIds.map(accountId => this.useCases.getLoyaltyAccount.execute(input.userId, LoyaltyAccountId.parse(accountId))));
    const proposal = assistantProposalSchema.parse({ kind: "trip_goal", payload: { title: canonical.title, targetPoints: canonical.targetPoints, targetDate: canonical.targetDate, accountIds, accountNames: accounts.map(account => account.provider.displayName), notes: canonical.notes } });
    return this.insert(input.userId, input.requestId, proposal);
  }

  private async insert(userId: UserId, requestId: string, proposal: AssistantProposal, executionWitness?: ManualBalanceAccountWitness) {
    const now = this.clock.now();
    // Request-scoped deterministic identity makes repeated identical tool calls idempotent.
    const id = `action_${createHash("sha256").update(JSON.stringify([userId, requestId, proposal])).digest("hex").slice(0, 40)}`;
    const action: AssistantAction = { ...proposal, ...(executionWitness ? { executionWitness } : {}), id, userId, status: "pending", createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS), result: null, failureCode: null };
    const stored = await this.repository.insert(action);
    this.record(stored);
    return toAssistantActionDto(stored);
  }

  private async owned(id: string, userId: UserId) {
    const action = await this.repository.findOwned(id, userId);
    if (!action) throw new AssistantActionNotFoundError();
    return action;
  }

  async reject(id: string, userId: UserId) {
    await this.refresh(userId);
    const action = await this.owned(id, userId);
    const now = this.clock.now();
    await this.repository.settlePending(id, userId, action.expiresAt <= now ? "expired" : "rejected", now);
    const stored = await this.owned(id, userId);
    this.record(stored);
    return toAssistantActionDto(stored);
  }

  async approve(id: string, userId: UserId) {
    await this.refresh(userId);
    const existing = await this.owned(id, userId);
    const now = this.clock.now();
    if (existing.status !== "pending") return toAssistantActionDto(existing);
    if (existing.expiresAt <= now) {
      await this.repository.settlePending(id, userId, "expired", now);
      return toAssistantActionDto(await this.owned(id, userId));
    }
    const action = await this.repository.claim(id, userId, now);
    if (!action) return toAssistantActionDto(await this.owned(id, userId));
    const started = performance.now();
    this.record(action);
    // Recheck ownership immediately before mutation. Proposal creation grants no future ownership.
    try {
      if (action.kind === "manual_balance") {
        const account = await this.useCases.getLoyaltyAccount.execute(userId, LoyaltyAccountId.parse(action.payload.accountId));
        if (account.provider.id !== action.payload.providerId) throw new InvalidAssistantActionError("Account program changed after proposal.");
        if (!matchesAccountIdentityWitness(action.executionWitness, { id: account.id, userId, providerId: account.provider.id, membershipNumber: account.membershipNumber })) throw new InvalidAssistantActionError("Account identity changed after proposal.");
      } else {
        await Promise.all(action.payload.accountIds.map(accountId => this.useCases.getLoyaltyAccount.execute(userId, LoyaltyAccountId.parse(accountId))));
      }
    } catch {
      await this.repository.finish(id, userId, "failed", this.clock.now(), null, "PRECONDITION_FAILED");
      const failed = await this.owned(id, userId);
      this.record(failed, Math.round(performance.now() - started));
      return toAssistantActionDto(failed);
    }
    let guardFailure: AccountIdentityPreconditionError | undefined;
    const onPreconditionFailure = (error: AccountIdentityPreconditionError) => { guardFailure = error; };
    if (this.unitOfWork?.atomic) {
      try {
        await this.unitOfWork.run(async () => {
          const result = await this.executeSaved(action, userId, onPreconditionFailure);
          await this.repository.finish(id, userId, "succeeded", this.clock.now(), result, null);
        });
      } catch (error) {
        // A transaction/commit exception alone cannot prove rollback. A durable
        // executing claim prevents replay; conditional finish also preserves a
        // committed success if its acknowledgement was lost.
        const knownPreconditionFailure = guardFailure !== undefined && error === guardFailure;
        try { await this.repository.finish(id, userId, knownPreconditionFailure ? "failed" : "unknown", this.clock.now(), null, knownPreconditionFailure ? "PRECONDITION_FAILED" : "EXECUTION_OUTCOME_UNKNOWN"); }
        catch { /* a stale durable claim is later exposed as unknown */ }
      }
      const completed = await this.owned(id, userId);
      this.record(completed, Math.round(performance.now() - started));
      return toAssistantActionDto(completed);
    }
    // Existing use cases may commit before a later activity/read step fails.
    // Only the exact witnessed pre-write guard rejection is known not to mutate;
    // other exceptions mean unknown, never safe-to-retry.
    let result: Record<string, unknown>;
    try {
      result = await this.executeSaved(action, userId, onPreconditionFailure);
    } catch (error) {
      const knownPreconditionFailure = guardFailure !== undefined && error === guardFailure;
      await this.repository.finish(id, userId, knownPreconditionFailure ? "failed" : "unknown", this.clock.now(), null, knownPreconditionFailure ? "PRECONDITION_FAILED" : "EXECUTION_OUTCOME_UNKNOWN");
      const unknown = await this.owned(id, userId);
      this.record(unknown, Math.round(performance.now() - started));
      return toAssistantActionDto(unknown);
    }
    try {
      await this.repository.finish(id, userId, "succeeded", this.clock.now(), result, null);
    } catch {
      // A journal failure after mutation must not authorize replay. Persist unknown if possible;
      // otherwise the claimed executing row becomes unknown when the lease is next inspected.
      try { await this.repository.finish(id, userId, "unknown", this.clock.now(), null, "JOURNAL_OUTCOME_UNKNOWN"); } catch { /* durable claim still prevents replay */ }
    }
    const completed = await this.owned(id, userId);
    this.record(completed, Math.round(performance.now() - started));
    return toAssistantActionDto(completed);
  }

  private async executeSaved(action: AssistantAction, userId: UserId, onPreconditionFailure: (error: AccountIdentityPreconditionError) => void): Promise<Record<string, unknown>> {
    if (action.kind === "manual_balance") {
      if (!action.executionWitness) throw new InvalidAssistantActionError("Account identity evidence is missing. Review a new proposal.");
      const balance = await this.useCases.recordManualBalance.execute({ userId, accountId: LoyaltyAccountId.parse(action.payload.accountId), points: action.payload.points, capturedAt: new Date(action.payload.capturedAt) }, { expectedAccountWitness: action.executionWitness, onPreconditionFailure });
      return { points: balance.points, capturedAt: balance.capturedAt.toISOString(), source: balance.source };
    }
    const goal = await this.useCases.createTripGoal.execute({ userId, title: action.payload.title, targetPoints: action.payload.targetPoints, targetDate: action.payload.targetDate, accountIds: action.payload.accountIds.map(value => LoyaltyAccountId.parse(value)), notes: action.payload.notes });
    return { goalId: goal.id, title: goal.title, targetPoints: goal.targetPoints };
  }
}
