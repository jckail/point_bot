import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserId } from "@pointup/core";

const state = vi.hoisted(() => ({ link: vi.fn(), update: vi.fn(), get: vi.fn(), options: [] as unknown[] }));
vi.mock("@/server/container", () => ({ getContainer: () => ({ useCases: { linkLoyaltyAccount: { execute: state.link }, updateLoyaltyAccount: { execute: state.update }, getLoyaltyAccount: { execute: state.get } } }) }));
vi.mock("@/server/http", () => ({ withAuthenticatedUser: (handler: (userId: UserId) => Promise<Response>, options: unknown) => { state.options.push(options); return handler(UserId.parse("synthetic-owner")); } }));
vi.mock("@/server/conditional", () => ({ jsonWithEtag: vi.fn() }));
vi.mock("@pointup/core/contracts", async original => ({ ...await original<object>(), toLoyaltyAccountDto: (account: unknown) => account }));
import { POST } from "./route";
import { PATCH } from "./[id]/route";
const url = "https://pointup.example/api/v1/loyalty-accounts";
const request = (method: string, body: unknown) => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.options.length = 0; state.link.mockResolvedValue({ accountId: "synthetic-account" }); state.update.mockResolvedValue(undefined); state.get.mockResolvedValue({ cardProductId: "chase-sapphire-preferred" }); });
describe("account HTTP card product propagation", () => {
  it("forwards selected product through the existing owner/write authority", async () => {
    await POST(request("POST", { providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "chase-sapphire-preferred" }));
    expect(state.link).toHaveBeenCalledWith(expect.objectContaining({ userId: UserId.parse("synthetic-owner"), cardProductId: "chase-sapphire-preferred" }));
    expect(state.options[0]).toMatchObject({ method: "POST", scope: "portfolio:write" });
  });
  it.each([{ cardProductId: "chase-sapphire-preferred" }, { cardProductId: null }, {}])("preserves selection/null/omission on PATCH %j", async body => {
    await PATCH(request("PATCH", body), { params: Promise.resolve({ id: "synthetic-account" }) });
    expect(state.update.mock.calls[0]?.[0]).toMatchObject({ userId: UserId.parse("synthetic-owner"), cardProductId: "cardProductId" in body ? body.cardProductId : undefined });
    expect(state.options[0]).toMatchObject({ method: "PATCH", scope: "portfolio:write" });
  });
  it("rejects unrecognized products before executing a write", async () => {
    await expect(POST(request("POST", { providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "invented-premium" }))).rejects.toThrow();
    expect(state.link).not.toHaveBeenCalled();
  });
});
