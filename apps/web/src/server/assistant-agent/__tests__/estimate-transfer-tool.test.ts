import { describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";
import { EstimateTransfer, GetLoyaltyAccount, ListActiveTransferBonuses, createLoyaltyAccount, createBalanceSnapshot, UserId } from "@pointup/core";
import type { CardProductId } from "@pointup/core/card-products";
import { InMemoryLoyaltyAccountRepository, InMemoryBalanceSnapshotRepository, InMemoryTransferBonusRepository } from "../../../../../../packages/core/test/fakes";
import { createPortfolioTools } from "../tools";

async function fixture(cardProductId: CardProductId | null = "chase-sapphire-preferred", foreign = false) {
  const owner = UserId.parse("SDK_PRIVATE_OWNER"), clock = { now: () => new Date("2026-10-02T12:00:00Z") };
  const accounts = new InMemoryLoyaltyAccountRepository(), balances = new InMemoryBalanceSnapshotRepository();
  const account = createLoyaltyAccount({ userId: foreign ? UserId.parse("SDK_FOREIGN_OWNER") : owner, providerId: "chase-ultimate-rewards", membershipNumber: "SDK_PRIVATE_MEMBER", credentialRef: "SDK_PRIVATE_CREDENTIAL", notes: "SDK_PRIVATE_NOTE", tags: ["sdk-private-tag"], cardProductId });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 40000, source: "manual", capturedAt: clock.now() }));
  const service = new EstimateTransfer(new GetLoyaltyAccount(accounts, balances, clock), new ListActiveTransferBonuses(new InMemoryTransferBonusRepository(), clock), clock);
  const execute = vi.spyOn(service, "execute");
  const events: unknown[] = [];
  const useCases = {
    getPortfolioSummary: { execute: vi.fn() }, listLoyaltyAccounts: { execute: vi.fn() }, listTripGoals: { execute: vi.fn() },
    getValueAdvice: { execute: vi.fn().mockResolvedValue({ transfers: [], deals: [], eligibilityWarnings: [] }) },
    chatWithAssistant: { execute: vi.fn() }, estimateTransfer: service,
  };
  const tools = createPortfolioTools(useCases, owner, new AbortController().signal, event => events.push(event));
  const target = tools.find(tool => tool.name === "estimate_transfer")!;
  const invoke = (args: unknown) => target.invoke(new RunContext(), JSON.stringify(args));
  const args = { accountId: account.id, toProviderId: "hyatt", sourcePoints: 40000 };
  return { args, invoke, execute, events, owner, useCases };
}
describe("targeted SDK transfer tool", () => {
  it("returns exact owner-scoped rule evidence despite empty ranked advice and sanitizes fields/telemetry", async () => {
    const f = await fixture();
    const output = await f.invoke(f.args);
    expect(JSON.parse(output)).toMatchObject({ status: "estimated", estimate: { destinationPoints: 30000, ratioFrom: 4, ratioTo: 3,
      eligibility: { sourceUrl: "https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred", effectiveFrom: "2026-10-01T00:00:00.000Z" } } });
    expect(f.execute).toHaveBeenCalledWith({ ...f.args, userId: f.owner });
    expect(f.useCases.getValueAdvice.execute).not.toHaveBeenCalled();
    expect(output).not.toMatch(/SDK_PRIVATE_|sdk-private-tag/);
    expect(JSON.stringify(f.events)).not.toMatch(/SDK_PRIVATE_|sdk-private-tag|40000|30000/);
    expect(f.events).toEqual([expect.objectContaining({ event: "tool_completed", tool: "estimate_transfer", status: "success" })]);
  });
  it.each([null, "chase-sapphire-reserve"] as const)("keeps unverified selection %s unavailable with no numeric estimate", async card => {
    const f = await fixture(card);
    expect(JSON.parse(await f.invoke(f.args))).toMatchObject({ status: "unavailable", estimate: null, hasEnoughSavedPoints: true, eligibilityWarnings: [expect.objectContaining({ toProviderId: "hyatt" })] });
  });
  it("denies foreign accounts without disclosing private errors", async () => {
    const f = await fixture("chase-sapphire-preferred", true);
    const output = await f.invoke(f.args);
    expect(output).not.toContain("SDK_FOREIGN_OWNER");
    expect(output).not.toContain("SDK_PRIVATE_MEMBER");
    expect(output).not.toContain("30000");
    expect(f.events).toEqual([expect.objectContaining({ tool: "estimate_transfer", status: "failed" })]);
  });
  it("rejects unsafe amounts, oversized identifiers and owner/card overrides before invoking the service", async () => {
    const f = await fixture();
    for (const args of [
      { ...f.args, sourcePoints: Number.MAX_SAFE_INTEGER + 1 }, { ...f.args, sourcePoints: -1 }, { ...f.args, sourcePoints: 0.5 },
      { ...f.args, accountId: "x".repeat(256) }, { ...f.args, toProviderId: "x".repeat(65) },
      { ...f.args, userId: "SDK_FOREIGN_OWNER" }, { ...f.args, cardProductId: "chase-sapphire-reserve" },
    ]) await f.invoke(args);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });
});
