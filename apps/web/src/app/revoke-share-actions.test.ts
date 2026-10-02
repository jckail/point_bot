import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortfolioShare, GetPublicPortfolioSnapshot, isShareActive,
  ListLoyaltyAccounts, RevokePortfolioShare, ShareId, UserId,
} from "@pointup/core";
import {
  InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository,
  InMemoryPortfolioShareRepository,
} from "../../../../packages/core/test/fakes";

const state = vi.hoisted(() => ({ session: vi.fn(), revoke: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({
  getContainer: () => ({ useCases: { revokePortfolioShare: { execute: state.revoke } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { revokePortfolioShareAction } from "./actions";

const owner = UserId.parse("synthetic-share-owner");
const shareId = ShareId.parse("synthetic-share");
const now = new Date("2026-10-02T12:00:00Z");
function form() {
  const data = new FormData(); data.set("shareId", shareId); return data;
}
function fixture() {
  const shares = new InMemoryPortfolioShareRepository();
  const share = createPortfolioShare({ id: shareId, userId: owner, label: "Friends", token: "synthetic-public-token", now });
  shares.rows.set(shareId, share);
  const update = vi.spyOn(shares, "update");
  const useCase = new RevokePortfolioShare(shares, { now: () => now });
  state.revoke.mockImplementation((userId, id) => useCase.execute(userId, id));
  return { shares, share, update };
}
beforeEach(() => { vi.resetAllMocks(); state.session.mockResolvedValue(owner); });

describe("dashboard share revocation feedback", () => {
  it("explains an expired session without invoking revocation or refreshing", async () => {
    const f = fixture(); state.session.mockResolvedValueOnce(null);
    expect(await revokePortfolioShareAction({ status: "idle" }, form())).toEqual({ status: "error", message: "Your session expired - sign in again." });
    expect(state.revoke).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.shares.rows.get(shareId)).toEqual(f.share); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it.each(["missing", "foreign"] as const)("keeps %s share failures private and performs no write", async kind => {
    const f = fixture();
    if (kind === "missing") f.shares.rows.delete(shareId);
    else state.session.mockResolvedValueOnce(UserId.parse("other-owner"));
    expect(await revokePortfolioShareAction({ status: "idle" }, form())).toEqual({ status: "error", message: "That share link wasn't found." });
    expect(f.update).not.toHaveBeenCalled(); expect(state.revalidate).not.toHaveBeenCalled();
    if (kind === "foreign") expect(f.shares.rows.get(shareId)).toEqual(f.share);
  });
  it("rejects an absent ID before invoking the mutation", async () => {
    const f = fixture();
    expect(await revokePortfolioShareAction({ status: "idle" }, new FormData())).toMatchObject({ status: "error" });
    expect(state.revoke).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.shares.rows.get(shareId)).toEqual(f.share); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("revokes an owned active token with no accounts, then denies the actual public resolver", async () => {
    const f = fixture();
    const accounts = new ListLoyaltyAccounts(new InMemoryLoyaltyAccountRepository(), new InMemoryBalanceSnapshotRepository(), { now: () => now });
    const publicSnapshot = new GetPublicPortfolioSnapshot(f.shares, accounts, { now: () => now });
    expect((await publicSnapshot.execute(f.share.token)).accountCount).toBe(0);
    expect(await revokePortfolioShareAction({ status: "idle" }, form())).toEqual({ status: "success" });
    expect(state.revoke).toHaveBeenCalledWith(owner, shareId);
    expect(f.update).toHaveBeenCalledOnce();
    expect(f.shares.rows.get(shareId)?.revokedAt).toEqual(now);
    expect(isShareActive(f.shares.rows.get(shareId)!, now)).toBe(false);
    await expect(publicSnapshot.execute(f.share.token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/dashboard");
  });
  it("propagates infrastructure failures without success, writes or refresh", async () => {
    const f = fixture(); const error = new Error("synthetic repository failure");
    vi.spyOn(f.shares, "findById").mockRejectedValueOnce(error);
    await expect(revokePortfolioShareAction({ status: "idle" }, form())).rejects.toBe(error);
    expect(f.update).not.toHaveBeenCalled(); expect(f.shares.rows.get(shareId)).toEqual(f.share);
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
