import { describe, expect, it } from "vitest";

import { buildExpirationCalendar } from "../src/application/loyalty/build-expiration-calendar";
import { BuildPortfolioDigest } from "../src/application/loyalty/build-portfolio-digest";
import { deriveAlerts } from "../src/application/loyalty/derive-alerts";
import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../src/domain/loyalty/provider";
import {
  FakeCredentialVault,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";
import { asUserId } from "./ids";

const owner = asUserId("united-expiry-owner");
const gateway = { supports: () => true, fetchBalance: async () => ({ points: 1200 }) };

describe("United MileagePlus no-expiry policy", () => {
  it("does not invent a deadline on linking, manual capture, or provider sync", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    let now = new Date("2026-10-02T12:00:00Z");
    const clock = { now: () => now };
    const linked = await new LinkLoyaltyAccount(accounts, undefined, clock).execute({
      userId: owner, providerId: "united", membershipNumber: "fixture-member",
    });
    expect(getProviderOrThrow("united").inactivityExpiryMonths).toBeNull();
    expect((await accounts.findById(linked.accountId))?.expiresAt).toBeNull();

    now = new Date("2026-10-03T12:00:00Z");
    await new RecordManualBalance(accounts, balances, undefined, clock).execute({
      userId: owner, accountId: linked.accountId, points: 1000,
    });
    expect((await accounts.findById(linked.accountId))?.expiresAt).toBeNull();
    now = new Date("2026-10-04T12:00:00Z");
    await new SyncLoyaltyAccount(accounts, balances, gateway, new FakeCredentialVault(), undefined, clock).execute({
      userId: owner, accountId: linked.accountId,
    });
    const digest = await new BuildPortfolioDigest(new ListLoyaltyAccounts(accounts, balances, clock)).execute(owner);
    expect(digest.accounts[0]).toMatchObject({
      expiresAt: null, daysUntilExpiry: null, latestBalance: { points: 1200, source: "sync" },
      provider: { inactivityExpiryMonths: null },
    });
    expect(digest.expiring).toEqual([]);
    expect(deriveAlerts(digest)).toEqual([]);
    expect(buildExpirationCalendar(digest.accounts)).not.toContain("BEGIN:VEVENT");
  });

  it("preserves an explicit saved date on reads and historical manual capture", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const now = new Date("2026-10-02T12:00:00Z");
    const expiry = new Date("2026-11-15T12:00:00Z");
    const account = createLoyaltyAccount({
      userId: owner, providerId: "united", membershipNumber: "fixture-member", now, expiresAt: expiry,
    });
    await accounts.insert(account);
    const list = new ListLoyaltyAccounts(accounts, balances, { now: () => now });
    expect((await list.execute(owner))[0]).toMatchObject({ expiresAt: expiry, daysUntilExpiry: 44 });
    expect((await accounts.findById(account.id))?.expiresAt).toEqual(expiry);

    await new RecordManualBalance(accounts, balances, undefined, { now: () => now }).execute({
      userId: owner, accountId: account.id, points: 1000, capturedAt: new Date("2026-09-01T12:00:00Z"),
    });
    const digest = await new BuildPortfolioDigest(list).execute(owner);
    expect((await accounts.findById(account.id))?.expiresAt).toEqual(expiry);
    expect(digest.accounts[0]?.expiresAt).toEqual(expiry);
    expect(deriveAlerts(digest)).toEqual([expect.objectContaining({ type: "expiring", providerId: "united" })]);
    expect(buildExpirationCalendar(digest.accounts)).toContain("DTSTART;VALUE=DATE:20261115\r\n");
  });

  it("retains existing forward activity refresh semantics for saved dates", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = createLoyaltyAccount({
      userId: owner, providerId: "united", membershipNumber: "fixture-member",
      now: new Date("2026-10-01T12:00:00Z"), expiresAt: new Date("2026-11-15T12:00:00Z"),
    });
    await accounts.insert(account);
    await new RecordManualBalance(accounts, balances, undefined, {
      now: () => new Date("2026-10-02T12:00:00Z"),
    }).execute({ userId: owner, accountId: account.id, points: 1000 });
    // Forward balance activity already recomputes expiry from the catalog;
    // correcting the policy does not introduce a bulk rewrite of saved rows.
    expect((await accounts.findById(account.id))?.expiresAt).toBeNull();
  });
});
