import { describe, expect, it, vi } from "vitest";
import { ChatWithAssistant } from "../src/application/loyalty/assistant";
import { CreateTripGoal } from "../src/application/loyalty/create-trip-goal";
import { ImportPortfolio } from "../src/application/loyalty/import-portfolio";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { ListTripGoals } from "../src/application/loyalty/list-trip-goals";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { applyTripGoalChanges, computeGoalProgress, createTripGoal } from "../src/domain/loyalty/trip-goal";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { buildTravelProviderGateway } from "../src/infrastructure/providers/build-gateway";
import { HeuristicAssistant } from "../src/infrastructure/llm/openai-compatible-assistant";
import { FakeCredentialVault, InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, InMemoryTripGoalRepository } from "./fakes";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const clock = { now: () => NOW };
function setup() {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const record = new RecordManualBalance(accounts, balances, undefined, clock);
  const importer = new ImportPortfolio(accounts, new LinkLoyaltyAccount(accounts, undefined, clock), record, clock);
  return { accounts, balances, record, importer };
}
const header = "providerId,membershipNumber,points,capturedAt";

describe("core data integrity regressions", () => {
  it("rechecks a provider membership created after import identity preflight", async () => {
    const { accounts, balances, importer } = setup();
    const account = createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "different-member" });
    await accounts.insert(account);
    // Model an older writer linking after the initial missing-row preflight.
    vi.spyOn(accounts, "findByUserAndProvider").mockResolvedValueOnce(null);
    await expect(importer.execute({ userId: "u", csv: header + "\nhyatt,export-member,100,2026-09-01" }))
      .rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(balances.rows).toHaveLength(0);
    expect((await accounts.findById(account.id))?.membershipNumber).toBe("different-member");
  });

  it("does not count duplicate goal account references more than once", () => {
    const goal = createTripGoal({ userId: "u", title: "Trip", targetPoints: 1000, accountIds: ["a", "a"] });
    expect(goal.accountIds).toEqual(["a"]);
    expect(applyTripGoalChanges(goal, { accountIds: ["b", "b"] }).accountIds).toEqual(["b"]);
    expect(computeGoalProgress({ ...goal, accountIds: ["a", "a"] }, new Map([["a", 600]])).currentPoints).toBe(600);
    expect(() => createTripGoal({ userId: "u", title: "Trip", targetPoints: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  it("does not fabricate sync balances without an integration", async () => {
    const { accounts, balances } = setup();
    const account = createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "H1" });
    await accounts.insert(account);
    const gateway = buildTravelProviderGateway();
    expect(gateway.supports("hyatt")).toBe(false);
    await expect(new SyncLoyaltyAccount(accounts, balances, gateway, new FakeCredentialVault()).execute({ userId: "u", accountId: account.id })).rejects.toMatchObject({ code: "PROVIDER_NOT_SUPPORTED" });
    expect(balances.rows).toHaveLength(0);
    expect(buildTravelProviderGateway({ allowSimulation: true }).supports("hyatt")).toBe(true);
    const scoped = buildTravelProviderGateway({ aggregator: { baseUrl: "https://example.invalid", apiKey: "fixture", supportedProviderIds: ["united"] } });
    expect(scoped.supports("united")).toBe(true);
    expect(scoped.supports("hyatt")).toBe(false);
  });

  it("preserves expiry and metadata for both synced and backfilled observations", async () => {
    const { accounts, balances, record } = setup();
    const account = createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "H1", expiresAt: new Date("2026-10-10"), now: NOW });
    await accounts.insert(account);
    await record.execute({ userId: "u", accountId: account.id, points: 500, capturedAt: new Date("2025-01-01") });
    await new SyncLoyaltyAccount(accounts, balances, { supports: () => true, fetchBalance: async () => ({ points: 700 }) }, new FakeCredentialVault(), undefined, clock).execute({ userId: "u", accountId: account.id });
    expect(await accounts.findById(account.id)).toEqual(account);
    expect(balances.rows).toHaveLength(2);
  });

  it("rejects unsafe integer balances before persistence", () => {
    expect(() => createBalanceSnapshot({ loyaltyAccountId: "a", source: "manual", points: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });

  it("imports quoted multiline memberships and escaped quotes as one record", async () => {
    const { importer, accounts, balances } = setup();
    const result = await importer.execute({ userId: "u", csv: `${header}\r\nhyatt,"H1\n""VIP""",100,2026-09-01T00:00:00.000Z\r\n` });
    expect(result).toEqual({ accountsLinked: 1, balancesRecorded: 1, skippedRows: 0 });
    expect((await accounts.findByUserAndProvider("u", "hyatt"))?.membershipNumber).toBe('H1\n"VIP"');
    expect(balances.rows[0]?.points).toBe(100);
  });

  it("rejects malformed CSV and conflicting memberships before any writes", async () => {
    for (const csv of [`${header}\nhyatt,"unterminated,100,2026-09-01`, `${header}\nhyatt,H1,100,2026-09-01\nhyatt,H2,200,2026-09-02`]) {
      const { importer, accounts, balances } = setup();
      await expect(importer.execute({ userId: "u", csv })).rejects.toMatchObject({ code: "INVALID_IMPORT" });
      expect(accounts.rows.size).toBe(0);
      expect(balances.rows).toHaveLength(0);
    }
  });

  it("does not merge another membership's history into an existing account", async () => {
    const { importer, accounts, balances } = setup();
    await accounts.insert(createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "H1" }));
    await expect(importer.execute({ userId: "u", csv: `${header}\nunited,U1,500,2026-09-01\nhyatt,H2,100,2026-09-01` })).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(accounts.rows.size).toBe(1);
    expect(balances.rows).toHaveLength(0);
  });

  it("skips future observations without replacing their timestamp", async () => {
    const { importer, balances } = setup();
    const result = await importer.execute({ userId: "u", csv: `${header}\nhyatt,H1,100,2027-01-01\nhyatt,H1,200,2026-09-01` });
    expect(result.balancesRecorded).toBe(1);
    expect(result.skippedRows).toBe(1);
    expect(balances.rows[0]?.capturedAt).toEqual(new Date("2026-09-01"));
  });

  it("skips deleted memberships and rejects them for new trip goals", async () => {
    const { importer, accounts, balances } = setup();
    const account = { ...createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "H1" }), deletedAt: NOW };
    await accounts.insert(account);
    expect(await importer.execute({ userId: "u", csv: `${header}\nhyatt,H1,100,2026-09-01` })).toEqual({ accountsLinked: 0, balancesRecorded: 0, skippedRows: 1 });
    await expect(new CreateTripGoal(new InMemoryTripGoalRepository(), accounts, balances).execute({ userId: "u", title: "Trip", targetPoints: 500, accountIds: [account.id] })).rejects.toMatchObject({ code: "LOYALTY_ACCOUNT_NOT_FOUND" });
  });

  it("grounds chat in unknown balances, actual expiry, and observation provenance", async () => {
    const { accounts, balances } = setup();
    await accounts.insert(createLoyaltyAccount({ userId: "u", providerId: "hyatt", membershipNumber: "private-member", expiresAt: new Date("2026-10-10") }));
    let system = "";
    const chat = new ChatWithAssistant(new ListLoyaltyAccounts(accounts, balances, clock), new ListTripGoals(new InMemoryTripGoalRepository(), balances), { complete: async (input) => { system = input.system; return "fixture"; } });
    await chat.execute({ userId: "u", message: "When do points expire?" });
    expect(system).toContain("unknown balance");
    expect(system).toContain("expiry=2026-10-10T00:00:00.000Z");
    expect(system).not.toContain("private-member");
    expect(system).toContain("does not reset inactivity expiry");
    const reply = await new HeuristicAssistant().complete({ system, messages: [{ role: "user", content: "expiry?" }] });
    expect(reply).not.toContain("sync or redeem");
  });
});
