import { describe, expect, it, vi } from "vitest";
import { selectGateway, selectProviderSyncMode } from "../src/composition/adapters";
import { buildTravelProviderGateway } from "../src/infrastructure/providers/build-gateway";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { ProviderNotSupportedError } from "../src/domain/errors";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { SyncAllLoyaltyAccounts } from "../src/application/loyalty/sync-all-loyalty-accounts";
import { FakeCredentialVault, InMemoryActivityEventRepository, InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, RecordingEventing } from "./fakes";
import { asUserId } from "./ids";

const account = (providerId = "united") => createLoyaltyAccount({ userId: asUserId("synthetic"), providerId, membershipNumber: "synthetic" });
describe("demo-only provider gateway composition", () => {
  it("has no implicit simulated provider for unconfigured real hosts", () => {
    const gateway = buildTravelProviderGateway();
    expect(gateway.supports("united")).toBe(false);
    expect(gateway.supports("chase-ultimate-rewards")).toBe(false);
    expect(() => gateway.fetchBalance(account(), null)).toThrow("No gateway registered");
  });
  it("requires an explicit demo flag to produce a simulated balance", async () => {
    const gateway = buildTravelProviderGateway({ allowSimulation: true });
    expect(gateway.supports("united")).toBe(true);
    const value = await gateway.fetchBalance(account(), null);
    expect(Number.isSafeInteger(value.points)).toBe(true);
    expect(value.points).toBeGreaterThanOrEqual(0);
    expect(buildTravelProviderGateway({ allowSimulation: false }).supports("united")).toBe(false);
  });
  it("keeps a configured real aggregator ahead of explicit demo simulation", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ points: 999 }) }));
    const gateway = buildTravelProviderGateway({ allowSimulation: true, aggregator: { baseUrl: "https://synthetic.test", apiKey: "synthetic", supportedProviderIds: ["united"], fetchImpl } });
    expect(await gateway.fetchBalance(account(), null)).toEqual({ points: 999 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("leaves providers outside a configured aggregator scope unavailable", () => {
    const gateway = buildTravelProviderGateway({ aggregator: { baseUrl: "https://synthetic.test", apiKey: "synthetic", supportedProviderIds: ["united"] } });
    expect(gateway.supports("united")).toBe(true);
    expect(gateway.supports("chase-ultimate-rewards")).toBe(false);
  });
  it("does not replace a failed real aggregator response with demo success", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => "Synthetic failure" }));
    const gateway = buildTravelProviderGateway({ allowSimulation: true, aggregator: { baseUrl: "https://synthetic.test", apiKey: "synthetic", fetchImpl } });
    await expect(gateway.fetchBalance(account(), null)).rejects.toThrow("503");
  });
  it("keeps incomplete real adapter configuration unavailable", () => {
    expect(buildTravelProviderGateway({ aggregator: { baseUrl: "https://synthetic.test" } }).supports("united")).toBe(false);
  });
  it("enables demo only for the explicit dev auth context shared by hosts", async () => {
    expect(selectProviderSyncMode({}, "united")).toBe("unavailable");
    expect(selectProviderSyncMode({ AUTH_PROVIDER: "clerk" }, "united")).toBe("unavailable");
    expect(selectProviderSyncMode({ AUTH_PROVIDER: "dev" }, "united")).toBe("demo");
    expect(selectGateway({ AUTH_PROVIDER: "dev" }).supports("united")).toBe(true);
    expect((await selectGateway({ AUTH_PROVIDER: "dev" }).fetchBalance(account(), null)).points).toBeGreaterThanOrEqual(0);
  });
  it("reports actual configured precedence/scopes without secrets or claims of vendor access", () => {
    const config = { AUTH_PROVIDER: "clerk" as const, AGGREGATOR_API_URL: "https://synthetic.test", AGGREGATOR_API_KEY: "private-test-key", aggregatorSupportedProviderIds: ["united"] };
    expect(selectProviderSyncMode(config, "united")).toBe("api");
    expect(selectGateway(config).supports("united")).toBe(true);
    expect(selectProviderSyncMode(config, "chase-ultimate-rewards")).toBe("unavailable");
    expect(selectGateway(config).supports("chase-ultimate-rewards")).toBe(false);
    expect(selectProviderSyncMode({ ...config, AUTH_PROVIDER: "dev" }, "united")).toBe("api");
    expect(selectProviderSyncMode({ ...config, AUTH_PROVIDER: "dev" }, "chase-ultimate-rewards")).toBe("demo");
    expect(selectProviderSyncMode({ AGGREGATOR_API_URL: config.AGGREGATOR_API_URL }, "united")).toBe("unavailable");
  });
  it("preserves observed balance history, metadata, activity and outbox when real sync is unavailable", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const activity = new InMemoryActivityEventRepository();
    const eventing = new RecordingEventing();
    const run = vi.spyOn(eventing.unitOfWork, "run");
    const owned = account("chase-ultimate-rewards");
    await accounts.insert(owned);
    const observed = createBalanceSnapshot({ loyaltyAccountId: owned.id, points: 123456, source: "agent", capturedAt: new Date(0) });
    await balances.insert(observed);
    const sync = new SyncLoyaltyAccount(accounts, balances, selectGateway({ AUTH_PROVIDER: "clerk" }), new FakeCredentialVault(), activity, undefined, eventing);
    await expect(sync.execute({ userId: owned.userId, accountId: owned.id })).rejects.toBeInstanceOf(ProviderNotSupportedError);
    expect(await new SyncAllLoyaltyAccounts(accounts, sync).execute(owned.userId)).toEqual([{ accountId: owned.id, ok: false, errorCode: "PROVIDER_NOT_SUPPORTED" }]);
    expect(balances.rows).toEqual([observed]);
    expect(await accounts.findById(owned.id)).toEqual(owned);
    expect(activity.rows).toEqual([]);
    expect(eventing.events).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
