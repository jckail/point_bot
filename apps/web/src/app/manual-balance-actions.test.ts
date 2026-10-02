import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoyaltyAccount, RecordManualBalance, UserId, type LoyaltyAccountId } from "@pointup/core";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository } from "../../../../packages/core/test/fakes";
const state = vi.hoisted(() => ({ session: vi.fn(), record: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { recordManualBalance: { execute: state.record } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { recordManualBalanceAction } from "./actions";
let balances: InMemoryBalanceSnapshotRepository;
let record: RecordManualBalance;
let accountId: LoyaltyAccountId;
const owner = UserId.parse("manual-date-owner");
function form(date?: string) { const value = new FormData(); value.set("accountId", accountId); value.set("points", "123"); if (date !== undefined) value.set("capturedOn", date); return value; }
beforeEach(async () => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T06:00:00Z"));
  state.session.mockResolvedValue(owner);
  const accounts = new InMemoryLoyaltyAccountRepository(); balances = new InMemoryBalanceSnapshotRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "united", membershipNumber: "synthetic", now: new Date() });
  await accounts.insert(account); accountId = account.id;
  record = new RecordManualBalance(accounts, balances);
  state.record.mockImplementation(input => record.execute(input));
});
afterEach(() => vi.useRealTimers());
describe("manual balance server action with real core capture-time guard", () => {
  it.each(["2026-10-02T00:00:00.000Z", "2026-10-02T06:00:00.000Z", "2026-10-02T12:00:00.000Z", "2026-10-02T18:00:00.000Z"])("records allowed today without inventing a future capture at %s", async instant => {
    vi.setSystemTime(new Date(instant));
    expect(await recordManualBalanceAction({ status: "idle" }, form("2026-10-02"))).toEqual({ status: "success" });
    const rows = await balances.findByAccountId(accountId, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capturedAt.getTime()).toBe(Math.min(Date.parse(instant), Date.parse("2026-10-02T12:00:00Z")));
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard");
    expect(state.revalidate).toHaveBeenCalledWith(`/dashboard/accounts/${accountId}`);
  });
  it.each([undefined, "", "2026-10-01", "2024-02-29"])("records blank/now or valid backfill %s", async date => {
    expect((await recordManualBalanceAction({ status: "idle" }, form(date))).status).toBe("success");
    const rows = await balances.findByAccountId(accountId, 10);
    expect(rows[0]?.capturedAt.toISOString()).toBe(date ? `${date}T12:00:00.000Z` : "2026-10-02T06:00:00.000Z");
  });
  it.each(["2026-10-03", "2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-10-02T00:00:00Z"])("rejects future or malformed input %s before write", async date => {
    expect(await recordManualBalanceAction({ status: "idle" }, form(date))).toEqual({ status: "error", message: "Choose a valid UTC date that is not in the future." });
    expect(state.record).not.toHaveBeenCalled(); expect(state.revalidate).not.toHaveBeenCalled();
    expect(balances.rows).toHaveLength(0);
  });
  it("retains the real core future guard and the action's fixed error mapping", async () => {
    state.record.mockImplementation(input => record.execute({ ...input, capturedAt: new Date("2026-10-03T00:00:00Z") }));
    expect(await recordManualBalanceAction({ status: "idle" }, form())).toEqual({ status: "error", message: "The date can't be in the future." });
    expect(balances.rows).toHaveLength(0); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("does not write without an authenticated owner", async () => {
    state.session.mockResolvedValueOnce(null);
    expect((await recordManualBalanceAction({ status: "idle" }, form())).status).toBe("error");
    expect(state.record).not.toHaveBeenCalled();
  });
});
