import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBalanceSnapshot, createLoyaltyAccount, DeleteCustomValuation,
  GetLoyaltyAccount, LoyaltyAccountId, SetCustomValuation,
  softDeleteLoyaltyAccount, UserId,
} from "@pointup/core";
import {
  InMemoryBalanceSnapshotRepository, InMemoryCustomValuationRepository,
  InMemoryLoyaltyAccountRepository,
} from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), set: vi.fn(), reset: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: {
  getLoyaltyAccount: { execute: state.get }, setCustomValuation: { execute: state.set },
  deleteCustomValuation: { execute: state.reset },
} }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { updateAccountValuationAction } from "./actions";

const owner = UserId.parse("valuation-owner");
const otherOwner = UserId.parse("other-valuation-owner");
const accountId = LoyaltyAccountId.parse("valuation-account");
const clock = { now: () => new Date("2026-10-02T12:00:00Z") };
const invalidRateMessage = "Enter a positive value up to 100 cents per point that rounds to at least 0.001.";
function form(rate: string | undefined = "1.2346", intent: string | undefined = "save") {
  const data = new FormData();
  data.set("accountId", accountId);
  if (intent !== undefined) data.set("intent", intent);
  if (rate !== undefined) data.set("centsPerPoint", rate);
  return data;
}
function fixture() {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const valuations = new InMemoryCustomValuationRepository();
  const account = createLoyaltyAccount({ id: accountId, userId: owner, providerId: "united", membershipNumber: "synthetic-private-membership", now: clock.now() });
  accounts.rows.set(account.id, account);
  balances.rows.push(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 1000, source: "manual", capturedAt: clock.now() }));
  const read = new GetLoyaltyAccount(accounts, balances, clock, valuations);
  const set = new SetCustomValuation(valuations, clock);
  const reset = new DeleteCustomValuation(valuations);
  state.get.mockImplementation((userId, id) => read.execute(userId, id));
  state.set.mockImplementation(input => set.execute(input));
  state.reset.mockImplementation((userId, providerId) => reset.execute(userId, providerId));
  const upsert = vi.spyOn(valuations, "upsert");
  const remove = vi.spyOn(valuations, "delete");
  return { accounts, balances, valuations, account, read, set, upsert, remove };
}
beforeEach(() => { vi.resetAllMocks(); state.session.mockResolvedValue(owner); });

function expectNoEffects(f: ReturnType<typeof fixture>) {
  expect(f.upsert).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  expect(f.valuations.rows.size).toBe(0); expect(state.revalidate).not.toHaveBeenCalled();
}

describe("account valuation action with actual owner-scoped core use cases", () => {
  it("derives the owned account provider, normalizes milli-cents and reads matching estimates", async () => {
    const f = fixture(); const data = form();
    data.set("providerId", "chase-ultimate-rewards"); data.set("userId", otherOwner);
    expect(await updateAccountValuationAction({ status: "idle" }, data)).toEqual({ status: "success" });
    expect(state.get).toHaveBeenCalledWith(owner, accountId);
    expect(state.set).toHaveBeenCalledWith({ userId: owner, providerId: "united", centsPerPoint: 1.2346 });
    expect(await f.valuations.listForUser(owner)).toEqual([{ userId: owner, providerId: "united", centsPerPoint: 1.235, updatedAt: clock.now() }]);
    const read = await f.read.execute(owner, accountId);
    expect(read.customCentsPerPoint).toBe(1.235); expect(read.estimatedValueCents).toBe(1235);
    expect(await f.valuations.listForUser(otherOwner)).toEqual([]);
    expect(f.upsert).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled();
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${accountId}`]]);
  });

  it("resets only the owner's provider override and reads the catalog fallback", async () => {
    const f = fixture();
    await f.set.execute({ userId: owner, providerId: "united", centsPerPoint: 2 });
    await f.set.execute({ userId: otherOwner, providerId: "united", centsPerPoint: 3 });
    f.upsert.mockClear();
    expect(await updateAccountValuationAction({ status: "idle" }, form("malformed-unused-rate", "reset"))).toEqual({ status: "success" });
    expect(state.reset).toHaveBeenCalledWith(owner, "united");
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(owner, "united"); expect(f.upsert).not.toHaveBeenCalled();
    expect(await f.valuations.listForUser(owner)).toEqual([]);
    expect((await f.valuations.listForUser(otherOwner))[0]?.centsPerPoint).toBe(3);
    const read = await f.read.execute(owner, accountId);
    expect(read.customCentsPerPoint).toBeNull();
    expect(read.estimatedValueCents).toBe(Math.round(1000 * read.provider.estimatedCentsPerPoint));
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${accountId}`]]);
  });

  it("harmlessly resets an absent owner override and refreshes the existing account", async () => {
    const f = fixture(); const data = form(undefined, "reset");
    data.delete("centsPerPoint");
    expect(await updateAccountValuationAction({ status: "idle" }, data)).toEqual({ status: "success" });
    expect(state.reset).toHaveBeenCalledWith(owner, "united");
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(owner, "united");
    expect(f.upsert).not.toHaveBeenCalled(); expect(f.valuations.rows.size).toBe(0);
    const read = await f.read.execute(owner, accountId);
    expect(read.customCentsPerPoint).toBeNull();
    expect(read.estimatedValueCents).toBe(Math.round(1000 * read.provider.estimatedCentsPerPoint));
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${accountId}`]]);
  });

  it.each([
    { input: "0.0005", normalized: 0.001, valueCents: 1 },
    { input: "100", normalized: 100, valueCents: 100000 },
  ])("accepts rate boundary $input with normalized persistence and readback", async ({ input, normalized, valueCents }) => {
    const f = fixture();
    expect(await updateAccountValuationAction({ status: "idle" }, form(input))).toEqual({ status: "success" });
    expect((await f.valuations.listForUser(owner))[0]?.centsPerPoint).toBe(normalized);
    const read = await f.read.execute(owner, accountId);
    expect(read.customCentsPerPoint).toBe(normalized); expect(read.estimatedValueCents).toBe(valueCents);
    expect(f.upsert).toHaveBeenCalledOnce(); expect(f.remove).not.toHaveBeenCalled();
    expect(state.revalidate.mock.calls).toEqual([["/dashboard"], [`/dashboard/accounts/${accountId}`]]);
  });

  it("rejects a missing account ID before reading or mutating", async () => {
    const f = fixture(); const data = form(); data.delete("accountId");
    expect(await updateAccountValuationAction({ status: "idle" }, data)).toEqual({ status: "error", message: "Something went wrong. Please try again." });
    expect(state.get).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled(); expect(state.reset).not.toHaveBeenCalled();
    expectNoEffects(f);
  });

  it.each(["0", "-1", "101", "NaN", "Infinity", "0.0001", "", "   ", undefined])("rejects invalid/tiny/blank save rate %s without persistence or refresh", async rate => {
    const f = fixture(); const data = form();
    if (rate === undefined) data.delete("centsPerPoint"); else data.set("centsPerPoint", rate);
    expect(await updateAccountValuationAction({ status: "idle" }, data)).toEqual({ status: "error", message: invalidRateMessage });
    expectNoEffects(f);
    expect(f.accounts.rows.get(accountId)).toEqual(f.account);
    expect(f.balances.rows).toHaveLength(1);
  });

  it.each(["", "delete", "SAVE", undefined])("rejects malformed or missing intent %s without effects", async intent => {
    const f = fixture(); const data = form();
    if (intent === undefined) data.delete("intent"); else data.set("intent", intent);
    expect(await updateAccountValuationAction({ status: "idle" }, data)).toEqual({ status: "error", message: invalidRateMessage });
    expect(state.get).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled(); expect(state.reset).not.toHaveBeenCalled();
    expectNoEffects(f);
  });

  it("returns session feedback before reading or mutating", async () => {
    const f = fixture(); state.session.mockResolvedValueOnce(null);
    expect(await updateAccountValuationAction({ status: "idle" }, form())).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(state.get).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled(); expect(state.reset).not.toHaveBeenCalled();
    expectNoEffects(f);
  });

  it.each(["foreign", "missing", "deleted"] as const)("keeps a %s account private and performs no valuation mutation", async kind => {
    const f = fixture();
    if (kind === "foreign") state.session.mockResolvedValueOnce(otherOwner);
    else if (kind === "missing") f.accounts.rows.delete(accountId);
    else f.accounts.rows.set(accountId, softDeleteLoyaltyAccount(f.account, clock.now()));
    expect(await updateAccountValuationAction({ status: "idle" }, form())).toEqual({ status: "error", message: "We couldn't find that account." });
    expect(state.set).not.toHaveBeenCalled(); expect(state.reset).not.toHaveBeenCalled(); expectNoEffects(f);
  });

  it.each(["read", "write"] as const)("propagates %s infrastructure failure without success or refresh", async stage => {
    const f = fixture(); const error = new Error("synthetic valuation infrastructure failure");
    if (stage === "read") vi.spyOn(f.accounts, "findById").mockRejectedValueOnce(error);
    else f.upsert.mockRejectedValueOnce(error);
    await expect(updateAccountValuationAction({ status: "idle" }, form())).rejects.toBe(error);
    expect(f.valuations.rows.size).toBe(0); expect(f.remove).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
