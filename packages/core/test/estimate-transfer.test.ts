import { describe, expect, it } from "vitest";
import { EstimateTransfer } from "../src/application/loyalty/estimate-transfer";
import { GetLoyaltyAccount } from "../src/application/loyalty/get-loyalty-account";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { GetValueAdvice } from "../src/application/loyalty/assistant";
import { ListActiveTransferBonuses } from "../src/application/loyalty/transfer-bonuses";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createTransferBonus } from "../src/domain/loyalty/transfer-bonus";
import type { CardProductId } from "../src/domain/loyalty/card-products";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTransferBonusRepository } from "./fakes";
import { asUserId } from "./ids";
const owner = asUserId("estimate-owner"), now = new Date("2026-10-02T12:00:00Z"), clock = { now: () => now };
async function fixture(cardProductId: CardProductId | null = "chase-sapphire-preferred") {
  const accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository(), bonusRepo = new InMemoryTransferBonusRepository();
  const account = createLoyaltyAccount({ userId: owner, providerId: "chase-ultimate-rewards", membershipNumber: "PRIVATE_MEMBER", credentialRef: "PRIVATE_VAULT", notes: "PRIVATE_NOTE", tags: ["private-tag"], cardProductId, now });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 40000, source: "manual", capturedAt: now }));
  const bonuses = new ListActiveTransferBonuses(bonusRepo, clock);
  const service = new EstimateTransfer(new GetLoyaltyAccount(accounts, balances, clock), bonuses, clock);
  const request = (toProviderId = "hyatt", sourcePoints = 40000, userId = owner) => service.execute({ userId, accountId: account.id, toProviderId, sourcePoints });
  return { accounts, balances, account, bonuses, bonusRepo, request };
}
describe("targeted transfer estimates", () => {
  it("returns a valid route omitted by ranked top-three advice", async () => {
    const f = await fixture();
    const ranked = await new GetValueAdvice(new ListLoyaltyAccounts(f.accounts, f.balances, clock), f.bonuses, clock).execute(owner);
    expect(ranked.transfers.some(option => option.to.id === "marriott")).toBe(false);
    expect(await f.request("marriott")).toMatchObject({ status: "estimated", estimate: { destinationPoints: 40000, ratioFrom: 1, ratioTo: 1 } });
  });
  it("uses affected card for 40k→30k with primary metadata, unknown limits and no private fields", async () => {
    const result = await (await fixture()).request();
    expect(result).toMatchObject({ status: "estimated", hasEnoughSavedPoints: true, estimate: { ratioFrom: 4, ratioTo: 3, destinationPoints: 30000, baseDestinationPoints: 30000,
      eligibility: { effectiveFrom: "2026-10-01T00:00:00.000Z", sourceUrl: "https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred" },
      limits: { minimumSourcePoints: null, incrementSourcePoints: null, status: "unknown", verification: "catalog_unverified" } } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|private-tag/);
    expect(result.caveats.join(" ")).toContain("not a transfer");
  });
  it.each([null, "chase-sapphire-reserve"] as const)("returns no numeric yield for unverified selection %s", async card => {
    const result = await (await fixture(card)).request();
    expect(result).toMatchObject({ status: "unavailable", estimate: null, hasEnoughSavedPoints: true });
    expect(result.eligibilityWarnings).toHaveLength(1);
  });
  it("applies only visible active bonuses and flags their verification separately", async () => {
    const f = await fixture();
    for (const [createdBy, multiplierPermille, startsAt, endsAt] of [
      [asUserId("foreign"), 2000, new Date("2026-10-01"), new Date("2026-10-04")], [owner, 1300, new Date("2026-10-01"), new Date("2026-10-04")], [owner, 1900, new Date("2026-09-01"), new Date("2026-09-04")],
    ] as const) await f.bonusRepo.insert(createTransferBonus({ fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt", source: "user", createdBy, multiplierPermille, startsAt, endsAt, now }));
    const result = await f.request();
    expect(result).toMatchObject({ estimate: { baseDestinationPoints: 30000, destinationPoints: 39000, bonus: { multiplierPermille: 1300, verified: false } } });
    expect(result.caveats.join(" ")).toContain("bonus is unverified");
  });
  it("separates hypothetical yield from saved balance sufficiency and catalog-only limits", async () => {
    expect(await (await fixture()).request("united", 40501)).toMatchObject({ status: "estimated", hasEnoughSavedPoints: false, estimate: { destinationPoints: 40501, limits: { status: "catalog_only", amountMatchesCatalog: false, verification: "catalog_unverified" } } });
  });
  it("rejects foreign ownership and unsafe/nonpositive amounts", async () => {
    const f = await fixture();
    await expect(f.request("hyatt", 40000, asUserId("foreign"))).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
    for (const value of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) await expect(f.request("hyatt", value)).rejects.toMatchObject({ code: "INVALID_BALANCE" });
  });
  it("does not invent a route between supported programs", async () => {
    expect(await (await fixture()).request("amtrak", 1000)).toMatchObject({ status: "unavailable", reason: "NO_TRANSFER_ROUTE", estimate: null });
  });
});
