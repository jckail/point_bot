import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoyaltyAccount,
  LoyaltyAccountId,
  RESTORE_WINDOW_MS,
  RestoreLoyaltyAccount,
  softDeleteLoyaltyAccount,
  UserId,
} from "@pointup/core";
import {
  InMemoryActivityEventRepository,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
  RecordingEventing,
} from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({
  session: vi.fn(),
  restore: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({
  getContainer: () => ({ useCases: { restoreLoyaltyAccount: { execute: state.restore } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { restoreLoyaltyAccountAction } from "./actions";

const owner = UserId.parse("restore-owner");
const accountId = LoyaltyAccountId.parse("restore-account");
const deletedAt = new Date("2026-10-01T00:00:00Z");
const deadline = deletedAt.getTime() + RESTORE_WINDOW_MS;

function form() {
  const data = new FormData();
  data.set("accountId", accountId);
  return data;
}

function fixture(now: Date) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const activity = new InMemoryActivityEventRepository();
  const eventing = new RecordingEventing();
  const clock = { now: () => now };
  const deleted = softDeleteLoyaltyAccount(createLoyaltyAccount({
    id: accountId, userId: owner, providerId: "united",
    membershipNumber: "synthetic-membership", now: deletedAt,
  }), deletedAt);
  accounts.rows.set(accountId, deleted);
  const update = vi.spyOn(accounts, "update");
  const restore = new RestoreLoyaltyAccount(accounts, balances, activity, clock, eventing);
  state.restore.mockImplementation((userId, id) => restore.execute(userId, id));
  return { accounts, activity, eventing, deleted, update, clock };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session.mockResolvedValue(owner);
});

describe("dashboard Restore feedback", () => {
  it("returns an expired-session error without invoking the mutation", async () => {
    state.session.mockResolvedValueOnce(null);
    expect(await restoreLoyaltyAccountAction({ status: "idle" }, form())).toEqual({
      status: "error", message: "Your session expired - sign in again.",
    });
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("maps the actual expired undo window to feedback without writes or revalidation", async () => {
    const f = fixture(new Date(deadline + 1));
    expect(await restoreLoyaltyAccountAction({ status: "idle" }, form())).toEqual({
      status: "error", message: "That program can't be restored — the undo window may have expired.",
    });
    expect(f.accounts.rows.get(accountId)).toEqual(f.deleted);
    expect(f.update).not.toHaveBeenCalled();
    expect(f.activity.rows).toEqual([]);
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("keeps the core fresh-clock check when the account read crosses the deadline", async () => {
    const f = fixture(new Date(deadline));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(f.accounts, "findById").mockImplementationOnce(async () => {
      entered();
      await gate;
      return f.deleted;
    });
    const result = restoreLoyaltyAccountAction({ status: "idle" }, form());
    await reading;
    f.clock.now = () => new Date(deadline + 1);
    release();
    expect(await result).toMatchObject({ status: "error" });
    expect(f.update).not.toHaveBeenCalled();
    expect(f.activity.rows).toEqual([]);
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("does not disclose or restore another owner's account", async () => {
    const f = fixture(new Date(deadline));
    state.session.mockResolvedValueOnce(UserId.parse("other-owner"));
    expect(await restoreLoyaltyAccountAction({ status: "idle" }, form())).toEqual({
      status: "error", message: "We couldn't find that account.",
    });
    expect(f.update).not.toHaveBeenCalled();
    expect(f.activity.rows).toEqual([]);
    expect(f.eventing.events).toEqual([]);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("preserves inclusive deadline restoration, ownership, events and dashboard refresh", async () => {
    const f = fixture(new Date(deadline));
    expect(await restoreLoyaltyAccountAction({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(state.restore).toHaveBeenCalledWith(owner, accountId);
    expect(f.accounts.rows.get(accountId)?.deletedAt).toBeNull();
    expect(f.update).toHaveBeenCalledOnce();
    expect(f.activity.rows.map(row => row.type)).toEqual(["account_restored"]);
    expect(f.eventing.types()).toEqual(["account.restored"]);
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });

  it("does not disguise infrastructure failure as success or revalidate", async () => {
    state.restore.mockRejectedValueOnce(new Error("synthetic infrastructure failure"));
    await expect(restoreLoyaltyAccountAction({ status: "idle" }, form())).rejects.toThrow("synthetic infrastructure failure");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
