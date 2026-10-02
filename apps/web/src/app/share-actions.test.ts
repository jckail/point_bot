import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidShareExpiryError } from "@pointup/core";
const state = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/auth", () => ({ getSessionUserId: state.session }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { createPortfolioShare: { execute: state.create } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { createPortfolioShareAction } from "./actions";
function form(expiry?: string, label = "Friends") { const data = new FormData(); data.set("label", label); if (expiry !== undefined) data.set("expiresInDays", expiry); return data; }
beforeEach(() => { vi.clearAllMocks(); state.session.mockResolvedValue("signed-in-owner"); state.create.mockResolvedValue(undefined); });
describe("dashboard share lifetime", () => {
  it.each(["not-a-number", "NaN", "Infinity", "-Infinity", "-1", "0", "0.5", "366", "9007199254740991"])("rejects nonempty invalid lifetime %s without creating an indefinite share", async expiry => {
    expect(await createPortfolioShareAction({ status: "idle" }, form(expiry))).toEqual({ status: "error", message: "Expiry must be a whole number of days between 1 and 365, or blank for no expiry." });
    expect(state.create).not.toHaveBeenCalled(); expect(state.revalidate).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "   ", "1", "365"])("preserves blank/no-expiry or valid lifetime %s", async expiry => {
    expect(await createPortfolioShareAction({ status: "idle" }, form(expiry))).toEqual({ status: "success" });
    expect(state.create).toHaveBeenCalledWith({ userId: "signed-in-owner", label: "Friends", expiresInDays: expiry?.trim() ? Number(expiry) : null });
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard");
  });
  it("preserves the shared label limit without creating a capability", async () => {
    expect((await createPortfolioShareAction({ status: "idle" }, form("1", "x".repeat(81)))).status).toBe("error");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("does not create links without a session and reports core validation without refreshing", async () => {
    state.session.mockResolvedValueOnce(null);
    expect((await createPortfolioShareAction({ status: "idle" }, form("1"))).status).toBe("error");
    expect(state.create).not.toHaveBeenCalled();
    state.create.mockRejectedValueOnce(new InvalidShareExpiryError());
    expect((await createPortfolioShareAction({ status: "idle" }, form("1"))).status).toBe("error");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
