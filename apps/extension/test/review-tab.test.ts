import { expect, it, vi } from "vitest";
import { openOwnedReviewTab } from "../src/review-tab";

it("allows a later review request after tab creation fails", async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error("Chrome unavailable")).mockResolvedValue({ id: 42 });
  const set = vi.fn(async () => undefined);
  vi.stubGlobal("chrome", { storage: { session: { get: async () => ({}), set } }, tabs: { create } });
  await expect(openOwnedReviewTab("https://pointup.example/dashboard/agents")).rejects.toThrow("Chrome unavailable");
  await openOwnedReviewTab("https://pointup.example/dashboard/agents#review-actions");
  expect(create).toHaveBeenCalledTimes(2);
  expect(set).toHaveBeenCalledWith({ assistantReviewTabId: 42 });
  vi.unstubAllGlobals();
});
