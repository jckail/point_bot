import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: vi.fn(), link: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { linkLoyaltyAccount: { execute: state.link }, updateLoyaltyAccount: { execute: state.update } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { linkLoyaltyAccountAction, updateCardProductAction, updateAccountNotesAction } from "./actions";
import { InvalidCardProductError } from "@pointup/core";
const data = (fields: Record<string, string>) => { const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); return form; };
beforeEach(() => { vi.clearAllMocks(); state.session.mockResolvedValue("owner"); state.link.mockResolvedValue({ accountId: "account" }); state.update.mockResolvedValue(undefined); });
describe("transfer card browser actions", () => {
  it("forwards selection when linking and refreshes advice", async () => {
    const result = await linkLoyaltyAccountAction({ status: "idle" }, data({ providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "chase-sapphire-preferred" }));
    expect(result.status).toBe("success");
    expect(state.link).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", cardProductId: "chase-sapphire-preferred" }));
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard");
  });
  it.each(["chase-sapphire-preferred", ""])("forwards explicit edit %s and refreshes account/advice", async selection => {
    await updateCardProductAction({ status: "idle" }, data({ accountId: "account", cardProductId: selection }));
    expect(state.update).toHaveBeenCalledWith({ userId: "owner", accountId: "account", cardProductId: selection || null });
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard");
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard/accounts/account");
  });
  it("notes edits omit selection", async () => {
    await updateAccountNotesAction({ status: "idle" }, data({ accountId: "account", notes: "Reserve", tags: "reserve" }));
    expect(state.update.mock.calls[0]?.[0]).not.toHaveProperty("cardProductId");
  });
  it("blocks unsigned edits and shows product validation errors without refreshing", async () => {
    state.session.mockResolvedValueOnce(null);
    expect((await updateCardProductAction({ status: "idle" }, data({ accountId: "account", cardProductId: "chase-sapphire-preferred" }))).status).toBe("error");
    expect(state.update).not.toHaveBeenCalled();
    state.update.mockRejectedValueOnce(new InvalidCardProductError());
    const result = await updateCardProductAction({ status: "idle" }, data({ accountId: "account", cardProductId: "invented" }));
    expect(result).toEqual({ status: "error", message: "Choose a transfer card that belongs to this program, or Unknown." });
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
