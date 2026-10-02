import { describe, expect, it } from "vitest";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import { FakeCredentialVault, InMemoryBalanceSnapshotRepository, InMemoryLoyaltyAccountRepository, RecordingEventing } from "./fakes";
import { asUserId } from "./ids";
const capture = new Date("2026-10-02T12:00:00Z");
const mutation = new Date("2026-10-02T12:00:10Z");
describe("sync capture waiting behind newer account metadata", () => {
  it.each([null, new Date("2029-01-01")])("preserves a newer locked expiry override %s and original capture provenance", async expiresAt => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const events = new RecordingEventing();
    const account = createLoyaltyAccount({ userId: asUserId("sync-owner"), providerId: "hyatt", membershipNumber: "synthetic", now: new Date("2026-09-01") });
    await accounts.insert(account);
    const metadataTime = new Date("2026-10-02T12:00:05Z");
    Object.assign(accounts, { lockById: async () => {
      const current = { ...account, updatedAt: metadataTime, expiresAt };
      await accounts.update(current);
      return current;
    } });
    const times = [capture, mutation];
    const sync = new SyncLoyaltyAccount(accounts, balances, new SimulatedTravelProviderGateway(), new FakeCredentialVault(), undefined, { now: () => times.shift()! }, events);
    const result = await sync.execute({ userId: account.userId, accountId: account.id });
    expect(await accounts.findById(account.id)).toMatchObject({ expiresAt, updatedAt: mutation });
    expect(result.capturedAt).toEqual(capture);
    expect(events.events[0]).toMatchObject({ payload: { capturedAt: capture.toISOString(), source: "sync" } });
  });
  it("retains the ordinary forward sync expiry refresh and uses fresh mutation time", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({ userId: asUserId("sync-owner"), providerId: "hyatt", membershipNumber: "synthetic", expiresAt: null, now: new Date("2026-09-01") });
    await accounts.insert(account);
    const times = [capture, mutation];
    const sync = new SyncLoyaltyAccount(accounts, balances, new SimulatedTravelProviderGateway(), new FakeCredentialVault(), undefined, { now: () => times.shift()! });
    expect((await sync.execute({ userId: account.userId, accountId: account.id })).capturedAt).toEqual(capture);
    expect(await accounts.findById(account.id)).toMatchObject({ expiresAt: new Date("2028-10-02T12:00:00Z"), updatedAt: mutation });
  });
  it("preserves metadata when a newer snapshot arrived while the provider reading waited", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const expiry = new Date("2029-01-01");
    const account = createLoyaltyAccount({ userId: asUserId("sync-owner"), providerId: "hyatt", membershipNumber: "synthetic", expiresAt: expiry, now: new Date("2026-09-01") });
    await accounts.insert(account);
    Object.assign(accounts, { lockById: async () => {
      await balances.insert(createBalanceSnapshot({ loyaltyAccountId: account.id, points: 99, source: "manual", capturedAt: new Date("2026-10-02T12:00:05Z") }));
      return account;
    } });
    const times = [capture, mutation];
    const sync = new SyncLoyaltyAccount(accounts, balances, new SimulatedTravelProviderGateway(), new FakeCredentialVault(), undefined, { now: () => times.shift()! });
    await sync.execute({ userId: account.userId, accountId: account.id });
    expect(await accounts.findById(account.id)).toMatchObject({ expiresAt: expiry, updatedAt: mutation });
  });
});
