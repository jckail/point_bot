import { describe, expect, it, vi } from "vitest";
import { PointUpClient } from "./index";

describe("card product HTTP requests", () => {
  it("preserves selection, explicit clear, and omission in shared account request DTOs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ accountId: "synthetic" }));
    const client = new PointUpClient({ baseUrl: "https://pointup.example", fetch });
    await client.linkLoyaltyAccount({ providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "chase-sapphire-preferred" });
    await client.updateLoyaltyAccount("synthetic", { cardProductId: "chase-sapphire-reserve" });
    await client.updateLoyaltyAccount("synthetic", { cardProductId: null });
    await client.updateLoyaltyAccount("synthetic", { notes: "unchanged selection" });
    expect(fetch.mock.calls.map(call => JSON.parse(call[1]!.body as string))).toEqual([
      { providerId: "chase-ultimate-rewards", membershipNumber: "synthetic", cardProductId: "chase-sapphire-preferred" },
      { cardProductId: "chase-sapphire-reserve" }, { cardProductId: null }, { notes: "unchanged selection" },
    ]);
  });
});
