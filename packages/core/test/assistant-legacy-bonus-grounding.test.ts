import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatWithAssistant } from "../src/application/loyalty/assistant";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { ListActiveTransferBonuses } from "../src/application/loyalty/transfer-bonuses";
import type { LlmAssistant } from "../src/application/ports";
import type { CardProductId } from "../src/domain/loyalty/card-products";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createTransferBonus, type TransferBonusSource } from "../src/domain/loyalty/transfer-bonus";
import * as ranking from "../src/domain/loyalty/transfer-ranking";
import { InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, InMemoryTransferBonusRepository, InMemoryTripGoalRepository } from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("legacy-grounding-owner");
const now = new Date("2026-10-15T12:00:00Z");

async function capture(options: { source?: TransferBonusSource; verified?: boolean; foreign?: boolean; cardProductId?: CardProductId | null; at?: Date } = {}) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const bonuses = new InMemoryTransferBonusRepository();
  const clock = { now: () => options.at ?? now };
  const account = createLoyaltyAccount({ userId: owner, providerId: "chase-ultimate-rewards", cardProductId: options.cardProductId === undefined ? "chase-sapphire-preferred" : options.cardProductId, membershipNumber: "PRIVATE_MEMBERSHIP", credentialRef: "PRIVATE_CREDENTIAL", notes: "PRIVATE_NOTE", now });
  await accounts.insert(account);
  await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 100_000, source: "manual", capturedAt: now }));
  if (options.source) await bonuses.insert(createTransferBonus({
    fromProviderId: account.providerId, toProviderId: "hyatt", multiplierPermille: 1300,
    startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-31T00:00:00Z"),
    source: options.source, sourceUrl: "https://example.com/bonus?private=PRIVATE_SOURCE_URL",
    verifiedAt: options.verified ? now : null, createdBy: options.foreign ? asUserId("other-owner") : owner, now,
  }));
  const complete = vi.fn<LlmAssistant["complete"]>().mockResolvedValue("Synthetic reply");
  const result = await new ChatWithAssistant(
    new ListLoyaltyAccounts(accounts, balances, clock),
    new ListTripGoals(new InMemoryTripGoalRepository(), balances),
    { complete }, new ListActiveTransferBonuses(bonuses, clock), clock,
  ).execute({ userId: owner, message: "How many Hyatt points could I receive?" });
  expect(complete).toHaveBeenCalledTimes(1);
  const input = complete.mock.calls[0]?.[0];
  if (!input) throw new Error("Missing synthetic provider call");
  expect(input.system).not.toMatch(/PRIVATE_MEMBERSHIP|PRIVATE_CREDENTIAL|PRIVATE_NOTE|PRIVATE_SOURCE_URL|https:\/\/example/);
  return { hints: result.context.valueHints, prompt: input.system, warnings: result.context.eligibilityWarnings };
}

afterEach(() => vi.restoreAllMocks());

describe("legacy assistant bonus grounding", () => {
  it.each(["manual", "scraped", "user"] as const)("preserves the unverified %s source beside the adjusted yield", async source => {
    const { hints, prompt } = await capture({ source });
    const hint = hints.find(value => value.includes("+30% bonus"));
    expect(hint).toContain("97,500");
    expect(hint).toContain(`[unverified; source: ${source}]`);
    expect(prompt).toContain(hint);
    expect(prompt).toContain("Require confirmation against the issuer before recommending a transfer that relies on an unverified or unknown bonus.");
  });

  it("distinguishes verified evidence and no bonus without changing the base yield", async () => {
    const verified = await capture({ source: "manual", verified: true });
    expect(verified.hints.find(value => value.includes("+30% bonus"))).toContain("[verified; source: manual]");
    expect(verified.hints.join("\n")).not.toContain("[unverified;");
    const base = await capture();
    expect(base.hints.length).toBeGreaterThan(0);
    expect(base.hints.join("\n")).not.toContain("97,500");
    expect(base.hints.join("\n")).not.toMatch(/bonus|source:|verified/);
  });

  it("treats optional legacy option metadata as unknown without assuming verification", async () => {
    const rank = ranking.rankTransferAdvice;
    // TransferOption permits metadata omission for legacy adapters; preserve
    // the actual resolver's card/date math while exercising that contract.
    vi.spyOn(ranking, "rankTransferAdvice").mockImplementation((...args) => {
      const result = rank(...args);
      return { ...result, options: result.options.map(option => {
        const { bonusVerified: _verification, bonusSource: _source, ...legacy } = option;
        return legacy;
      }) };
    });
    const { hints } = await capture({ source: "user" });
    expect(hints.find(value => value.includes("+30% bonus"))).toContain("[unverified; source: unknown]");
  });

  it("keeps owner visibility and the injected bonus window intact", async () => {
    const foreign = await capture({ source: "user", foreign: true });
    expect(foreign.hints.join("\n")).not.toContain("+30%");
    const expired = await capture({ source: "manual", at: new Date("2026-11-01T00:00:00Z") });
    expect(expired.hints.join("\n")).not.toContain("+30%");
    const base = await capture();
    expect(foreign.hints).toEqual(base.hints);
    expect(expired.hints).toEqual(base.hints);
  });

  it("does not invent a transfer yield when selected-card eligibility is unknown", async () => {
    const { hints, prompt, warnings } = await capture({ source: "user", cardProductId: null });
    expect(hints.join("\n")).not.toMatch(/Hyatt|\+30%/);
    expect(warnings.length).toBeGreaterThan(0);
    expect(prompt).toContain("Transfer eligibility warnings");
    expect(prompt).not.toContain("97,500");
  });
});
