import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTripGoal, DeleteTripGoal, TripGoalId, UserId } from "@pointup/core";
import { InMemoryTripGoalRepository, RecordingEventing } from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), remove: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({
  getContainer: () => ({ useCases: { deleteTripGoal: { execute: state.remove } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { deleteTripGoalAction } from "./actions";

const owner = UserId.parse("goal-owner");
const goalId = TripGoalId.parse("synthetic-goal");
const clock = { now: () => new Date("2026-10-02T00:00:00Z") };

function form(id = goalId) {
  const data = new FormData();
  data.set("goalId", id);
  return data;
}

function fixture() {
  const goals = new InMemoryTripGoalRepository();
  const eventing = new RecordingEventing();
  // A past target date does not impose an invented deletion deadline.
  const goal = createTripGoal({ id: goalId, userId: owner, title: "Synthetic trip", targetPoints: 1000, targetDate: "2020-01-01", now: clock.now() });
  goals.rows.set(goalId, goal);
  const remove = vi.spyOn(goals, "delete");
  const useCase = new DeleteTripGoal(goals, clock, eventing);
  state.remove.mockImplementation((userId, id) => useCase.execute(userId, id));
  return { goals, eventing, goal, remove };
}

beforeEach(() => {
  vi.resetAllMocks();
  state.session.mockResolvedValue(owner);
});

describe("dashboard Goal Remove feedback", () => {
  it("returns session feedback without invoking deletion", async () => {
    state.session.mockResolvedValueOnce(null);
    expect(await deleteTripGoalAction({ status: "idle" }, form())).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign"] as const)("returns private not-found feedback for a %s goal without effects", async kind => {
    const f = fixture();
    if (kind === "missing") f.goals.rows.delete(goalId);
    else state.session.mockResolvedValueOnce(UserId.parse("other-owner"));
    expect(await deleteTripGoalAction({ status: "idle" }, form())).toEqual({ status: "error", message: "We couldn't find that goal." });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
    if (kind === "foreign") expect(f.goals.rows.get(goalId)).toEqual(f.goal);
  });

  it("does not repeat deletion, publication or refresh for an already removed goal", async () => {
    const f = fixture();
    expect(await deleteTripGoalAction({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(await deleteTripGoalAction({ status: "idle" }, form())).toEqual({ status: "error", message: "We couldn't find that goal." });
    expect(f.remove).toHaveBeenCalledOnce();
    expect(f.eventing.types()).toEqual(["goal.deleted"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("maps an absent ID before invoking the mutation", async () => {
    const f = fixture();
    expect(await deleteTripGoalAction({ status: "idle" }, new FormData())).toEqual({ status: "error", message: "Something went wrong. Please try again." });
    expect(state.remove).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.eventing.events).toEqual([]);
    expect(f.goals.rows.get(goalId)).toEqual(f.goal);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("removes the owned goal with a past target date and publishes once before refresh", async () => {
    const f = fixture();
    expect(await deleteTripGoalAction({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(state.remove).toHaveBeenCalledWith(owner, goalId);
    expect(f.goals.rows.has(goalId)).toBe(false);
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(goalId);
    expect(f.eventing.types()).toEqual(["goal.deleted"]);
    expect(f.eventing.events[0]).toMatchObject({ userId: owner, aggregateId: goalId, payload: {} });
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("uses the fresh core read when the goal disappears before lookup completes", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(f.goals, "findById").mockImplementationOnce(async id => {
      entered();
      await gate;
      return f.goals.rows.get(id) ?? null;
    });
    const result = deleteTripGoalAction({ status: "idle" }, form());
    try {
      await reading;
      f.goals.rows.delete(goalId);
    } finally {
      release();
    }
    expect(await result).toEqual({ status: "error", message: "We couldn't find that goal." });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("propagates infrastructure failure without returning success or refreshing", async () => {
    const f = fixture();
    const error = new Error("synthetic infrastructure failure");
    vi.spyOn(f.goals, "findById").mockRejectedValueOnce(error);
    await expect(deleteTripGoalAction({ status: "idle" }, form())).rejects.toBe(error);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
