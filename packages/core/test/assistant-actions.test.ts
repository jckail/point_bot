import { UserId } from "../src/domain/shared/ids";
import { describe, expect, it, vi } from "vitest";
import { ManageAssistantActions } from "../src/application/assistant/manage-actions";
import { AssistantActionNotFoundError, assistantActionProposalRequestSchema, type AssistantAction, type AssistantActionRepository, type AssistantActionClaimResult, type AssistantActionStatus, type RecoveredAssistantAction } from "../src/domain/assistant/actions";
import type { Clock } from "../src/application/ports";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTripGoalRepository } from "./fakes";

const owner = UserId.parse("owner");
const other = UserId.parse("other");

class MemoryActions implements AssistantActionRepository {
  constructor(private readonly clock: Clock) {}
  readonly rows = new Map<string, AssistantAction>();
  readonly transitions: AssistantActionStatus[] = [];
  failSuccessJournal = false;
  async insert(action: AssistantAction) { if (!this.rows.has(action.id)) this.rows.set(action.id, structuredClone(action)); return structuredClone(this.rows.get(action.id)!); }
  async findOwned(id: string, userId: UserId) { const action = this.rows.get(id); return action?.userId === userId ? structuredClone(action) : null; }
  async listOwned(userId: UserId, limit: number) { return [...this.rows.values()].filter(row => row.userId === userId).slice(0, limit).map(row => structuredClone(row)); }
  async claim(id: string, userId: UserId, now: Date): Promise<AssistantActionClaimResult> {
    const action = this.rows.get(id);
    if (!action || action.userId !== userId || action.status !== "pending") return { outcome: "unavailable" };
    const claimedAt = new Date(Math.max(now.getTime(), this.clock.now().getTime()));
    if (action.expiresAt <= claimedAt) {
      this.rows.set(id, { ...action, status: "expired", updatedAt: claimedAt }); this.transitions.push("expired");
      return { outcome: "expired", transition: { id, kind: action.kind, status: "expired" } };
    }
    const claimed = { ...action, status: "executing" as const, updatedAt: claimedAt };
    this.rows.set(id, claimed); this.transitions.push("executing"); return { outcome: "claimed", action: structuredClone(claimed) };
  }
  async settlePending(id: string, userId: UserId, status: "rejected" | "expired", now: Date) {
    const action = this.rows.get(id);
    if (action?.userId !== userId || action.status !== "pending" || (status === "expired" ? action.expiresAt > now : action.expiresAt <= now)) return null;
    this.rows.set(id, { ...action, status, updatedAt: now }); this.transitions.push(status);
    return { id, kind: action.kind, status };
  }
  async finish(id: string, userId: UserId, status: "succeeded" | "failed" | "unknown", now: Date, result: Record<string, unknown> | null, failureCode: string | null) {
    if (status === "succeeded" && this.failSuccessJournal) throw new Error("Journal unavailable");
    const action = this.rows.get(id);
    if (action?.userId === userId && action.status === "executing") { this.rows.set(id, { ...action, status, updatedAt: now, result, failureCode }); this.transitions.push(status); }
  }
  async expireExecuting(userId: UserId, cutoff: Date, now: Date) {
    const recovered: RecoveredAssistantAction[] = [];
    for (const [id, row] of this.rows) if (row.userId === userId && row.status === "executing" && row.updatedAt <= cutoff) {
      this.rows.set(id, { ...row, status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN", updatedAt: now });
      recovered.push({ id, kind: row.kind, status: "unknown" });
    }
    return recovered;
  }
}
async function fixture() {
  let now = new Date("2026-10-01T12:00:00Z");
  const clock = { now: () => new Date(now) };
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const goals = new InMemoryTripGoalRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "hyatt", membershipNumber: "PRIVATE-MEMBER" });
  await accounts.insert(account);
  const repository = new MemoryActions(clock);
  const useCases = { getLoyaltyAccount: new GetLoyaltyAccount(accounts, balances, clock), recordManualBalance: new RecordManualBalance(accounts, balances, undefined, clock), createTripGoal: new CreateTripGoal(goals, accounts, balances, clock) };
  const audit = vi.fn();
  const service = new ManageAssistantActions(repository, useCases, clock, audit);
  const propose = () => service.proposeManualBalance({ userId: owner, requestId: "request", accountId: account.id, points: 40000, capturedAt: "2026-10-01T11:00:00Z" });
  return { service, repository, useCases, clock, accounts, account, balances, goals, audit, propose, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}

describe("persistent reviewed assistant actions", () => {
  it("persists immutable owned proposals without mutating balances", async () => {
    const f = await fixture();
    const action = await f.propose();
    expect(action).toMatchObject({ kind: "manual_balance", status: "pending", payload: { points: 40000, providerId: "hyatt" } });
    expect(JSON.stringify(action)).not.toContain("PRIVATE-MEMBER");
    if (action.kind !== "manual_balance") throw new Error("Wrong proposal kind");
    action.payload.points = 1;
    const stored = await f.repository.findOwned(action.id, owner);
    expect(stored?.payload).toMatchObject({ points: 40000 });
    expect(f.balances.rows).toHaveLength(0);
    expect((await f.propose()).id).toBe(action.id);
    expect(f.repository.rows.size).toBe(1);
  });

  it("concurrent approvals execute once and replay returns the persisted outcome", async () => {
    const f = await fixture();
    const action = await f.propose();
    await Promise.all([f.service.approve(action.id, owner), f.service.approve(action.id, owner)]);
    expect(f.balances.rows).toHaveLength(1);
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "succeeded", result: { points: 40000 } });
    expect(f.balances.rows).toHaveLength(1);
    expect(f.repository.transitions.filter(status => status === "executing")).toHaveLength(1);
    expect(JSON.stringify(f.audit.mock.calls)).not.toMatch(/PRIVATE-MEMBER|40000/);
  });

  it("hides foreign proposals and prevents owner changes before mutation", async () => {
    const f = await fixture();
    const action = await f.propose();
    await expect(f.service.approve(action.id, other)).rejects.toBeInstanceOf(AssistantActionNotFoundError);
    const moved = { ...f.account, userId: other };
    await f.accounts.update(moved);
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expect(f.balances.rows).toHaveLength(0);
  });

  it("rejects and expires proposals without writes, including approval after restart", async () => {
    const f = await fixture();
    const action = await f.propose();
    f.advance(15 * 60000);
    const restarted = new ManageAssistantActions(f.repository, f.useCases, { now: () => new Date("2026-10-01T12:15:00Z") });
    expect(await restarted.approve(action.id, owner)).toMatchObject({ status: "expired" });
    const another = await f.service.proposeTripGoal({ userId: owner, requestId: "goal", title: "Kyoto", targetPoints: 80000, accountIds: [f.account.id] });
    expect(await f.service.reject(another.id, owner)).toMatchObject({ status: "rejected" });
    expect(await f.service.approve(another.id, owner)).toMatchObject({ status: "rejected" });
    expect(f.goals.rows.size).toBe(0);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("audits one pending expiry across concurrent list, approve, reject and repeated reads", async () => {
    const f = await fixture(), action = await f.propose();
    const row = f.repository.rows.get(action.id)!;
    f.repository.rows.set("foreign", { ...row, id: "foreign", userId: other });
    f.repository.rows.set("terminal", { ...row, id: "terminal", status: "succeeded" });
    f.advance(15 * 60000); f.audit.mockClear();
    const restarted = new ManageAssistantActions(f.repository, f.useCases, f.clock, f.audit);
    await Promise.all([f.service.list(owner), restarted.approve(action.id, owner), f.service.reject(action.id, owner)]);
    await f.service.list(owner); await f.service.reject(action.id, owner); await restarted.approve(action.id, owner);
    expect(f.audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: "expired" }]]);
    expect(f.repository.rows.get("foreign")?.status).toBe("pending");
    expect(f.repository.rows.get("terminal")?.status).toBe("succeeded");
    await expect(f.service.reject("foreign", owner)).rejects.toBeInstanceOf(AssistantActionNotFoundError);
    expect(f.balances.rows).toHaveLength(0); expect(f.goals.rows.size).toBe(0);
    expect(JSON.stringify(f.audit.mock.calls)).not.toMatch(/PRIVATE-MEMBER|40000|nonce|digest|executionWitness|payload|userId/);
  });

  it("audits concurrent rejection once and does not re-audit terminal reads", async () => {
    const f = await fixture(), action = await f.propose(); f.audit.mockClear();
    await Promise.all([f.service.reject(action.id, owner), f.service.reject(action.id, owner)]);
    await f.service.reject(action.id, owner); await f.service.approve(action.id, owner); await f.service.list(owner);
    expect(f.audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: "rejected" }]]);
    expect(f.repository.transitions).toEqual(["rejected"]);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("audits expiry committed by claim after the clock advances while approval waits", async () => {
    const f = await fixture(), action = await f.propose(); f.audit.mockClear();
    const claim = f.repository.claim.bind(f.repository);
    let release!: () => void, reached!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.repository, "claim").mockImplementation(async (...args) => { reached(); await gate; return claim(...args); });
    const approval = f.service.approve(action.id, owner);
    await entered; f.advance(15 * 60000); release();
    expect(await approval).toMatchObject({ status: "expired" });
    await f.service.approve(action.id, owner); await f.service.list(owner);
    expect(f.audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: "expired" }]]);
    expect(f.repository.transitions).toEqual(["expired"]);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("does not audit a stale rejection when approval wins its conditional transition", async () => {
    const f = await fixture(), action = await f.propose(); f.audit.mockClear();
    const settle = f.repository.settlePending.bind(f.repository);
    let release!: () => void, reached!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.repository, "settlePending").mockImplementation(async (...args) => { reached(); await gate; return settle(...args); });
    const rejection = f.service.reject(action.id, owner);
    await entered;
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "succeeded" });
    release(); expect(await rejection).toMatchObject({ status: "succeeded" });
    expect(f.audit.mock.calls.map(([event]) => event.status)).toEqual(["executing", "succeeded"]);
    expect(f.balances.rows).toHaveLength(1);
    expect(f.repository.transitions).toEqual(["executing", "succeeded"]);
  });

  it.each(["expired", "rejected"] as const)("keeps committed %s visible and non-executing when transition audit throws", async status => {
    const f = await fixture(), action = await f.propose();
    if (status === "expired") f.advance(15 * 60000);
    const audit = vi.fn(() => { throw new Error("synthetic telemetry unavailable"); });
    const restarted = new ManageAssistantActions(f.repository, f.useCases, f.clock, audit);
    expect(await restarted.reject(action.id, owner)).toMatchObject({ status });
    await restarted.reject(action.id, owner); await restarted.list(owner); await restarted.approve(action.id, owner);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("executes only the saved exact goal values after browser approval", async () => {
    const f = await fixture();
    const action = await f.service.proposeTripGoal({ userId: owner, requestId: "goal", title: "Kyoto", targetPoints: 80000, targetDate: "2027-04-01", accountIds: [f.account.id] });
    expect(f.goals.rows.size).toBe(0);
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "succeeded", result: { title: "Kyoto", targetPoints: 80000 } });
    expect(f.goals.rows.size).toBe(1);
    await f.service.approve(action.id, owner);
    expect(f.goals.rows.size).toBe(1);
  });

  it.each([
    ["  Planning notes  ", "Planning notes"],
    [" \n\t ", null],
  ])("stores the exact canonical notes that approval executes: %j", async (notes, expected) => {
    const f = await fixture();
    const action = await f.service.proposeTripGoal({ userId: owner, requestId: "normalized-goal", title: "  Kyoto  ", targetPoints: 80000, targetDate: "2027-04-01", accountIds: [f.account.id], notes });
    if (action.kind !== "trip_goal") throw new Error("Wrong proposal kind");
    expect(action.payload.notes).toBe(expected);
    expect(f.goals.rows.size).toBe(0);
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "succeeded" });
    const executed = [...f.goals.rows.values()][0]!;
    expect(executed).toMatchObject({ title: action.payload.title, targetPoints: action.payload.targetPoints, targetDate: action.payload.targetDate, accountIds: action.payload.accountIds, notes: action.payload.notes });
  });

  it("marks a commit followed by failure unknown and never retries it", async () => {
    const f = await fixture();
    const action = await f.propose();
    const original = f.useCases.recordManualBalance.execute.bind(f.useCases.recordManualBalance);
    vi.spyOn(f.useCases.recordManualBalance, "execute").mockImplementation(async input => { await original(input); throw new Error("activity failed after balance commit"); });
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN" });
    await f.service.approve(action.id, owner);
    expect(f.balances.rows).toHaveLength(1);
    expect(f.useCases.recordManualBalance.execute).toHaveBeenCalledTimes(1);
  });

  it("preserves non-replayable unknown state when outcome journaling fails", async () => {
    const f = await fixture();
    const action = await f.propose();
    f.repository.failSuccessJournal = true;
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "unknown", failureCode: "JOURNAL_OUTCOME_UNKNOWN" });
    await f.service.approve(action.id, owner);
    expect(f.balances.rows).toHaveLength(1);
  });

  it("preserves a committed success when the transaction acknowledgement is lost", async () => {
    const f = await fixture();
    const action = await f.propose();
    const unitOfWork = { atomic: true, run: async <T>(work: () => Promise<T>): Promise<T> => {
      await work();
      throw new Error("synthetic lost commit acknowledgement");
    } };
    const service = new ManageAssistantActions(f.repository, f.useCases, f.clock, undefined, unitOfWork);
    expect(await service.approve(action.id, owner)).toMatchObject({ status: "succeeded" });
    await service.approve(action.id, owner);
    expect(f.balances.rows).toHaveLength(1);
    expect(f.repository.transitions).toEqual(["executing", "succeeded"]);
  });

  it("recovers crashed executing proposals to visible unknown instead of replaying", async () => {
    const f = await fixture();
    const action = await f.propose();
    await f.repository.claim(action.id, owner, new Date("2026-10-01T12:00:00Z"));
    f.advance(5 * 60000);
    expect((await f.service.list(owner))[0]).toMatchObject({ status: "unknown" });
    await f.service.approve(action.id, owner);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("audits only actual stale transitions once across concurrent and repeated recovery", async () => {
    const f = await fixture(), action = await f.propose();
    await f.repository.claim(action.id, owner, f.clock.now());
    const stale = f.repository.rows.get(action.id)!;
    f.repository.rows.set("recent", { ...stale, id: "recent", updatedAt: new Date(f.clock.now().getTime() + 1) });
    f.repository.rows.set("foreign", { ...stale, id: "foreign", userId: other });
    f.repository.rows.set("terminal", { ...stale, id: "terminal", status: "succeeded" });
    f.advance(5 * 60000);
    f.audit.mockClear();
    const restarted = new ManageAssistantActions(f.repository, f.useCases, f.clock, f.audit);
    await Promise.all([f.service.list(owner), restarted.list(owner)]);
    await f.service.list(owner);
    await f.service.approve(action.id, owner);
    expect(f.audit.mock.calls).toEqual([[{ event: "assistant_action", actionId: action.id, kind: "manual_balance", status: "unknown" }]]);
    expect(f.repository.rows.get("recent")?.status).toBe("executing");
    expect(f.repository.rows.get("foreign")?.status).toBe("executing");
    expect(f.repository.rows.get("terminal")?.status).toBe("succeeded");
    expect(f.balances.rows).toHaveLength(0);
    expect(JSON.stringify(f.audit.mock.calls)).not.toMatch(/PRIVATE-MEMBER|40000|nonce|digest|executionWitness|payload|userId/);
  });

  it("keeps recovered unknown visible and non-replayable when the audit throws", async () => {
    const f = await fixture(), action = await f.propose();
    await f.repository.claim(action.id, owner, f.clock.now());
    f.advance(5 * 60000);
    const audit = vi.fn(() => { throw new Error("synthetic telemetry unavailable"); });
    const restarted = new ManageAssistantActions(f.repository, f.useCases, f.clock, audit);
    expect((await restarted.list(owner))[0]).toMatchObject({ id: action.id, status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN" });
    await restarted.list(owner);
    await restarted.approve(action.id, owner);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(f.balances.rows).toHaveLength(0);
  });

  it("rejects cross-owner references and payload/status/owner overrides", async () => {
    const f = await fixture();
    await expect(f.service.proposeManualBalance({ userId: other, requestId: "r", accountId: f.account.id, points: 500 })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(assistantActionProposalRequestSchema.safeParse({ kind: "manual_balance", accountId: f.account.id, points: 100, userId: other, status: "succeeded" }).success).toBe(false);
    await expect(f.service.proposeManualBalance({ userId: owner, requestId: "r", accountId: f.account.id, points: 100, capturedAt: "2030-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "INVALID_ASSISTANT_ACTION" });
  });
});
