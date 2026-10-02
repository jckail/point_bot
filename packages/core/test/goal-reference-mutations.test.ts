import { describe, expect, it, vi } from "vitest";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { DeleteTripGoal, UpdateTripGoal } from "../src/application/loyalty/update-trip-goal";
import { UnlinkLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import type { Eventing } from "../src/application/events/ports";
import type { DomainEvent } from "../src/domain/events";
import { createLoyaltyAccount, softDeleteLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { computeGoalProgress, createTripGoal, type TripGoal } from "../src/domain/loyalty/trip-goal";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { LoyaltyAccountId, UserId } from "../src/domain/shared/ids";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, InMemoryTripGoalRepository } from "./fakes";

const owner = UserId.parse("goal-owner"), now = new Date("2026-10-02T12:00:00Z"), clock = { now: () => now };
class GoalRepository extends InMemoryTripGoalRepository {
  override async update(goal: TripGoal, options?: { readonly replaceAccountIds?: boolean }): Promise<void> {
    void options;
    await super.update(goal);
  }
}
async function fixture() {
  const accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository(), goals = new GoalRepository();
  const account = createLoyaltyAccount({ id: LoyaltyAccountId.parse("z-american"), userId: owner, providerId: "american", membershipNumber: "member", now });
  await accounts.insert(account);
  const goal = createTripGoal({ userId: owner, title: "Original", targetPoints: 1000, accountIds: [account.id], notes: "original note", now });
  await goals.insert(goal);
  const publisher = { publish: vi.fn(async (_events: readonly DomainEvent[]) => {}) };
  const eventing: Eventing = { publisher, unitOfWork: { atomic: true, run: async work => work() } };
  const lockById = vi.fn((id: LoyaltyAccountId) => accounts.findById(id));
  const lockedAccounts = Object.assign(accounts, { lockById });
  const lockedGoals = Object.assign(goals, { lockById: vi.fn((id: typeof goal.id) => goals.findById(id)) });
  const create = new CreateTripGoal(lockedGoals, lockedAccounts, balances, clock, eventing);
  const update = new UpdateTripGoal(lockedGoals, lockedAccounts, balances, clock, eventing);
  return { accounts: lockedAccounts, balances, goals: lockedGoals, goal, account, publisher, eventing, create, update };
}
describe("goal account-reference mutations", () => {
  it.each(["create", "update"] as const)("%s rejects an owned soft-deleted selected account without writing or publishing", async kind => {
    const f = await fixture();
    await f.accounts.update(softDeleteLoyaltyAccount(f.account, now));
    const write = vi.spyOn(f.goals, kind === "create" ? "insert" : "update");
    const operation = kind === "create" ? f.create.execute({ userId: owner, title: "New", targetPoints: 1000, accountIds: [f.account.id] })
      : f.update.execute({ userId: owner, goalId: f.goal.id, accountIds: [f.account.id] });
    await expect(operation).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    expect(write).not.toHaveBeenCalled(); expect(f.publisher.publish).not.toHaveBeenCalled();
  });
  it.each(["create", "update"] as const)("%s rechecks deletion after a simulated lock wait behind actual unlink", async kind => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    f.accounts.lockById.mockImplementationOnce(async id => { entered(); await gate; return f.accounts.findById(id); });
    const operation = (kind === "create" ? f.create.execute({ userId: owner, title: "New", targetPoints: 1000, accountIds: [f.account.id] })
      : f.update.execute({ userId: owner, goalId: f.goal.id, accountIds: [f.account.id] })).then(value => ({ value }), error => ({ error }));
    await waiting;
    try {
      await new UnlinkLoyaltyAccount(f.accounts, undefined, clock, f.eventing).execute(owner, f.account.id);
    } finally { release(); }
    expect(await operation).toMatchObject({ error: { code: "LOYALTY_ACCOUNT_NOT_FOUND" } });
    expect(f.publisher.publish.mock.calls.flat().flat().map(event => event.type)).toEqual(["account.unlinked"]);
    expect(f.goals.rows.size).toBe(1);
    expect(await f.goals.findById(f.goal.id)).toEqual(f.goal);
  });
  it("locks within the UOW in provider order and preserves first-occurrence membership order", async () => {
    const f = await fixture();
    const other = createLoyaltyAccount({ id: LoyaltyAccountId.parse("a-united"), userId: owner, providerId: "united", membershipNumber: "member", now });
    await f.accounts.insert(other);
    let inside = false;
    f.eventing.unitOfWork.run = async work => { inside = true; try { return await work(); } finally { inside = false; } };
    f.accounts.lockById.mockImplementation(async id => { expect(inside).toBe(true); return f.accounts.findById(id); });
    const result = await f.create.execute({ userId: owner, title: "Ordered", targetPoints: 1000, accountIds: [other.id, f.account.id, other.id] });
    expect(f.accounts.lockById.mock.calls.map(([id]) => id)).toEqual([f.account.id, other.id]);
    expect(result.accountIds).toEqual([other.id, f.account.id]);
  });
  it("duplicate references never turn 600 points into an achieved 1000-point goal", async () => {
    const f = await fixture();
    await f.balances.insert(createBalanceSnapshot({ loyaltyAccountId: f.account.id, points: 600, source: "manual", capturedAt: now }));
    const created = await f.create.execute({ userId: owner, title: "Canonical", targetPoints: 1000, accountIds: [f.account.id, f.account.id] });
    expect(created).toMatchObject({ accountIds: [f.account.id], currentPoints: 600, remainingPoints: 400, achieved: false });
    expect((await f.goals.findById(created.id))?.accountIds).toEqual([f.account.id]);
    const updated = await f.update.execute({ userId: owner, goalId: created.id, accountIds: [f.account.id, f.account.id] });
    expect(updated).toMatchObject({ accountIds: [f.account.id], currentPoints: 600, achieved: false });
    // Historical/injected domain objects also cannot double-count progress.
    expect(computeGoalProgress({ ...f.goal, accountIds: [f.account.id, f.account.id] }, new Map([[f.account.id, 600]])))
      .toMatchObject({ currentPoints: 600, remainingPoints: 400, achieved: false });
  });
  it("omitted references preserve historical membership without revalidating or rewriting; explicit empty clears", async () => {
    const f = await fixture();
    await f.accounts.update(softDeleteLoyaltyAccount(f.account, now));
    const write = vi.spyOn(f.goals, "update");
    expect((await f.update.execute({ userId: owner, goalId: f.goal.id, title: "New title" })).accountIds).toEqual([f.account.id]);
    expect(f.accounts.lockById).not.toHaveBeenCalled();
    expect(write.mock.calls[0]?.[1]).toEqual({ replaceAccountIds: false });
    expect((await f.update.execute({ userId: owner, goalId: f.goal.id, accountIds: [] })).accountIds).toEqual([]);
    expect(write.mock.calls[1]?.[1]).toEqual({ replaceAccountIds: true });
  });
  it("applies an omitted-field patch to the fresh locked goal after a concurrent disjoint patch", async () => {
    const f = await fixture();
    f.goals.lockById.mockImplementationOnce(async () => {
      await f.goals.update({ ...f.goal, notes: "concurrent note" });
      return f.goals.findById(f.goal.id);
    });
    expect(await f.update.execute({ userId: owner, goalId: f.goal.id, title: "New title" })).toMatchObject({ title: "New title", notes: "concurrent note" });
  });
  it("deletion checks ownership on the locked goal inside the UOW", async () => {
    const f = await fixture();
    f.goals.lockById.mockResolvedValueOnce(null);
    await expect(new DeleteTripGoal(f.goals, clock, f.eventing).execute(owner, f.goal.id)).rejects.toMatchObject({ code: "TRIP_GOAL_NOT_FOUND" });
    expect(f.goals.rows.size).toBe(1); expect(f.publisher.publish).not.toHaveBeenCalled();
  });
  it.each(["update", "delete"] as const)("%s rejects row locks without atomic UOW before mutation", async kind => {
    const f = await fixture();
    const operation = kind === "update"
      ? new UpdateTripGoal(f.goals, f.accounts, f.balances, clock).execute({ userId: owner, goalId: f.goal.id, title: "Unsafe" })
      : new DeleteTripGoal(f.goals, clock).execute(owner, f.goal.id);
    await expect(operation).rejects.toThrow("Goal mutations require an atomic unit of work and goal locking");
    expect(await f.goals.findById(f.goal.id)).toEqual(f.goal);
    expect(f.goals.lockById).not.toHaveBeenCalled();
  });
  it.each(["update", "delete"] as const)("%s rejects atomic UOW without row locks before mutation", async kind => {
    const f = await fixture(), goals = new GoalRepository();
    await goals.insert(f.goal);
    const operation = kind === "update"
      ? new UpdateTripGoal(goals, f.accounts, f.balances, clock, f.eventing).execute({ userId: owner, goalId: f.goal.id, title: "Unsafe" })
      : new DeleteTripGoal(goals, clock, f.eventing).execute(owner, f.goal.id);
    await expect(operation).rejects.toThrow("Goal mutations require an atomic unit of work and goal locking");
    expect(await goals.findById(f.goal.id)).toEqual(f.goal);
    expect(f.publisher.publish).not.toHaveBeenCalled();
  });
});
