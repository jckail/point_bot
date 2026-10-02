import { describe, expect, it, vi } from "vitest";
import { ManageAssistantActions } from "../src/application/assistant/manage-actions";
import { createAccountIdentityWitness } from "../src/application/loyalty/account-identity-witness";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { assistantActionProposalRequestSchema, toAssistantActionDto, type AssistantAction, type AssistantActionRepository } from "../src/domain/assistant/actions";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { UserId, type LoyaltyAccountId } from "../src/domain/shared/ids";
import { DrizzleAssistantActionRepository } from "../src/infrastructure/assistant/drizzle-action-repository";
import type { Database } from "../src/infrastructure/db/client";
import type { UnitOfWork } from "../src/application/events/ports";
import { InMemoryActivityEventRepository, InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTripGoalRepository } from "./fakes";

const owner = UserId.parse("membership-witness-owner"), now = new Date("2026-10-02T12:00:00Z");
class Journal implements AssistantActionRepository {
  readonly rows = new Map<string, AssistantAction>();
  async insert(action: AssistantAction) { if (!this.rows.has(action.id)) this.rows.set(action.id, structuredClone(action)); return structuredClone(this.rows.get(action.id)!); }
  async findOwned(id: string, userId: UserId) { const row = this.rows.get(id); return row?.userId === userId ? structuredClone(row) : null; }
  async listOwned(userId: UserId) { return [...this.rows.values()].filter(row => row.userId === userId).map(row => structuredClone(row)); }
  async claim(id: string, userId: UserId, at: Date) { const row = await this.findOwned(id, userId); if (!row || row.status !== "pending" || row.expiresAt <= at) return null; const claimed = { ...row, status: "executing" as const, updatedAt: at }; this.rows.set(id, claimed); return structuredClone(claimed); }
  async settlePending(id: string, userId: UserId, status: "expired" | "rejected", at: Date) { const row = await this.findOwned(id, userId); if (row?.status === "pending") this.rows.set(id, { ...row, status, updatedAt: at }); }
  async finish(id: string, userId: UserId, status: "succeeded" | "failed" | "unknown", at: Date, result: Record<string, unknown> | null, failureCode: string | null) { const row = await this.findOwned(id, userId); if (row?.status !== "executing") throw new Error("Claim unavailable"); this.rows.set(id, { ...row, status, updatedAt: at, result, failureCode }); }
  async expireExecuting() { return []; }
}
class LockedAccounts extends InMemoryLoyaltyAccountRepository {
  readonly locks: LoyaltyAccountId[] = [];
  async lockById(id: LoyaltyAccountId) { this.locks.push(id); return this.findById(id); }
}
async function fixture(unitOfWork?: UnitOfWork) {
  const accounts = new LockedAccounts(), balances = new InMemoryBalanceSnapshotRepository(), activity = new InMemoryActivityEventRepository(), goals = new InMemoryTripGoalRepository(), journal = new Journal();
  const clock = { now: () => now }, publisher = { publish: vi.fn(async () => {}) };
  // A synchronous fixture UOW exercises guard placement, not database rollback.
  const eventing = { publisher, unitOfWork: { atomic: true, run: async <T>(work: () => Promise<T>) => work() } };
  const account = createLoyaltyAccount({ userId: owner, providerId: "hyatt", membershipNumber: "PRIVATE_ORIGINAL_MEMBER", now });
  await accounts.insert(account);
  const useCases = { getLoyaltyAccount: new GetLoyaltyAccount(accounts, balances, clock), recordManualBalance: new RecordManualBalance(accounts, balances, activity, clock, eventing), createTripGoal: new CreateTripGoal(goals, accounts, balances, clock) };
  const audit = vi.fn(), service = new ManageAssistantActions(journal, useCases, clock, audit, unitOfWork ?? eventing.unitOfWork);
  const propose = () => service.proposeManualBalance({ userId: owner, requestId: "immutable-request", accountId: account.id, points: 100, capturedAt: now.toISOString() });
  return { accounts, balances, activity, journal, account, publisher, useCases, service, audit, propose };
}
function expectNoMutation(f: Awaited<ReturnType<typeof fixture>>) { expect(f.balances.rows).toHaveLength(0); expect(f.activity.rows).toHaveLength(0); expect(f.publisher.publish).not.toHaveBeenCalled(); }

describe("private proposal membership evidence", () => {
  it("persists an immutable witness without exposing it through review DTOs, audit or client input", async () => {
    const f = await fixture(), dto = await f.propose();
    const stored = await f.journal.findOwned(dto.id, owner);
    expect(stored?.executionWitness).toMatchObject({ version: 1, kind: "manual_balance_account_identity" });
    const witness = stored?.executionWitness;
    if (!witness) throw new Error("Missing fixture witness");
    expect((await f.propose()).id).toBe(dto.id);
    expect((await f.journal.findOwned(dto.id, owner))?.executionWitness).toEqual(witness);
    const publicValues = JSON.stringify([dto, await f.service.list(owner), f.audit.mock.calls]);
    expect(publicValues).not.toContain("PRIVATE_ORIGINAL_MEMBER"); expect(publicValues).not.toContain(witness.digest); expect(publicValues).not.toContain(witness.nonce);
    expect(assistantActionProposalRequestSchema.safeParse({ kind: "manual_balance", accountId: f.account.id, points: 100, executionWitness: witness }).success).toBe(false);
    expect(await f.service.approve(dto.id, owner)).toMatchObject({ status: "succeeded", result: { points: 100 } });
    expect(await f.service.approve(dto.id, owner)).toMatchObject({ status: "succeeded" });
    expect(f.balances.rows).toHaveLength(1);
  });

  it("refuses the original proposal after same-program membership replacement", async () => {
    const f = await fixture(), action = await f.propose();
    await f.accounts.update({ ...f.account, membershipNumber: "PRIVATE_REPLACEMENT_MEMBER" });
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expectNoMutation(f); expect(f.accounts.locks).toHaveLength(0);
  });

  it("checks the locked current membership even when the preceding account read was stale", async () => {
    const f = await fixture(), action = await f.propose(), read = f.useCases.getLoyaltyAccount.execute.bind(f.useCases.getLoyaltyAccount);
    vi.spyOn(f.useCases.getLoyaltyAccount, "execute").mockImplementation(async (...args) => {
      const stale = await read(...args);
      await f.accounts.update({ ...f.account, membershipNumber: "PRIVATE_REPLACEMENT_MEMBER" });
      return stale;
    });
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expect(f.accounts.locks).toEqual([f.account.id]); expectNoMutation(f);
  });

  it("retains unknown classification when a transaction wrapper obscures a guard rejection", async () => {
    const wrapper = { atomic: true, run: async <T>(work: () => Promise<T>): Promise<T> => { try { return await work(); } catch { throw new Error("PRIVATE_TRANSACTION_FAILURE"); } } };
    const f = await fixture(wrapper), action = await f.propose(), read = f.useCases.getLoyaltyAccount.execute.bind(f.useCases.getLoyaltyAccount);
    vi.spyOn(f.useCases.getLoyaltyAccount, "execute").mockImplementation(async (...args) => { const stale = await read(...args); await f.accounts.update({ ...f.account, membershipNumber: "PRIVATE_REPLACEMENT_MEMBER" }); return stale; });
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "unknown", failureCode: "EXECUTION_OUTCOME_UNKNOWN" });
    expectNoMutation(f);
  });

  it.each([null, { version: 1 as const, kind: "manual_balance_account_identity" as const, nonce: "malformed", digest: "0".repeat(64) }])("fails closed for legacy or malformed pending evidence", async executionWitness => {
    const f = await fixture(), dto = await f.propose(), row = f.journal.rows.get(dto.id)!;
    f.journal.rows.set(dto.id, { ...row, executionWitness });
    expect(await f.service.approve(dto.id, owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expectNoMutation(f);
  });

  it.each(["succeeded", "rejected", "expired", "failed", "unknown", "executing"] as const)("preserves legacy %s outcomes without starting mutation", async status => {
    const f = await fixture(), dto = await f.propose(), row = f.journal.rows.get(dto.id)!;
    f.journal.rows.set(dto.id, { ...row, status, executionWitness: null });
    expect(await f.service.approve(dto.id, owner)).toMatchObject({ status }); expectNoMutation(f);
  });

  it("keeps direct manual and agent inputs unchanged and does not bind notes or selected card", async () => {
    const f = await fixture(), action = await f.propose();
    await f.accounts.update({ ...f.account, notes: "PRIVATE_NEW_NOTE", tags: ["different"] });
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "succeeded" });
    await f.useCases.recordManualBalance.execute({ userId: owner, accountId: f.account.id, points: 200, source: "manual" });
    await f.useCases.recordManualBalance.executeWithSnapshotId({ userId: owner, accountId: f.account.id, points: 300, source: "agent" });
    expect(f.balances.rows.map(row => row.source)).toEqual(["manual", "manual", "agent"]);
  });

  it("hydrates private JSONB metadata separately and does not persist an extra database column", async () => {
    const f = await fixture(), dto = await f.propose(), action = f.journal.rows.get(dto.id)!;
    let saved: Record<string, unknown> | undefined;
    const db = { insert: () => ({ values: (value: Record<string, unknown>) => { saved = value; return { onConflictDoNothing: () => ({ returning: async () => [value] }) }; } }) } as unknown as Database;
    const hydrated = await new DrizzleAssistantActionRepository(db).insert(action);
    expect(saved).not.toHaveProperty("executionWitness"); expect(saved).toHaveProperty("payload.__pointupExecutionWitness", action.executionWitness);
    expect(hydrated.executionWitness).toEqual(action.executionWitness);
    expect(hydrated.payload).toEqual(action.payload);
    expect(toAssistantActionDto(hydrated)).toEqual(dto);
    expect(JSON.stringify(saved)).not.toContain("PRIVATE_ORIGINAL_MEMBER");
    const witness = createAccountIdentityWitness({ id: f.account.id, userId: owner, providerId: "hyatt", membershipNumber: f.account.membershipNumber });
    expect(witness.digest).not.toBe(action.executionWitness?.digest);
  });

  it.each([undefined, { version: 9 }, { version: 1, kind: "manual_balance_account_identity", nonce: "bad", digest: "0".repeat(64) }])("hydrates missing or malformed stored evidence as non-executable without exposing it", async executionWitness => {
    const f = await fixture(), dto = await f.propose(), action = f.journal.rows.get(dto.id)!;
    const row = { ...action, payload: { ...action.payload, ...(executionWitness === undefined ? {} : { __pointupExecutionWitness: executionWitness }) } };
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }) } as unknown as Database;
    const hydrated = await new DrizzleAssistantActionRepository(db).findOwned(action.id, owner);
    expect(hydrated?.executionWitness).toBeNull();
    if (!hydrated) throw new Error("Missing hydrated fixture action");
    expect(toAssistantActionDto(hydrated)).toEqual(dto);
    f.journal.rows.set(action.id, hydrated);
    expect(await f.service.approve(action.id, owner)).toMatchObject({ status: "failed", failureCode: "PRECONDITION_FAILED" });
    expectNoMutation(f);
  });
});
