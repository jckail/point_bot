import { describe, expect, it } from "vitest";

import { GetBalanceHistory } from "../src/application/loyalty/get-balance-history";
import { GetPortfolioSummary } from "../src/application/loyalty/get-portfolio-summary";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import { RecordManualBalance } from "../src/application/loyalty/record-manual-balance";
import { SyncAllLoyaltyAccounts } from "../src/application/loyalty/sync-all-loyalty-accounts";
import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import {
  RestoreLoyaltyAccount,
} from "../src/application/loyalty/restore-loyalty-account";
import {
  UnlinkLoyaltyAccount,
  UpdateLoyaltyAccount,
} from "../src/application/loyalty/update-loyalty-account";
import {
  InvalidBalanceError,
  InvalidCaptureTimeError,
  InvalidMembershipNumberError,
  LoyaltyAccountNotFoundError,
} from "../src/domain/errors";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import {
  FakeCredentialVault,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

function seedAccount(
  accounts: InMemoryLoyaltyAccountRepository,
  overrides: Partial<Parameters<typeof createLoyaltyAccount>[0]> = {},
) {
  const account = createLoyaltyAccount({
    userId: "user-1",
    providerId: "united",
    membershipNumber: "MP123456",
    ...overrides,
  });
  accounts.rows.set(account.id, account);
  return account;
}

describe("UpdateLoyaltyAccount", () => {
  it("updates the membership number and credential ref", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts);

    await new UpdateLoyaltyAccount(accounts).execute({
      userId: "user-1",
      accountId: account.id,
      membershipNumber: "MP999",
      credentialRef: "op://vault/item",
    });

    const updated = accounts.rows.get(account.id);
    expect(updated?.membershipNumber).toBe("MP999");
    expect(updated?.credentialRef).toBe("op://vault/item");
  });

  it("clears the credential ref with null and keeps omitted fields", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts, { credentialRef: "op://v/i" });

    await new UpdateLoyaltyAccount(accounts).execute({
      userId: "user-1",
      accountId: account.id,
      credentialRef: null,
    });

    const updated = accounts.rows.get(account.id);
    expect(updated?.credentialRef).toBeNull();
    expect(updated?.membershipNumber).toBe("MP123456");
  });

  it("rejects blank membership numbers", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts);

    await expect(
      new UpdateLoyaltyAccount(accounts).execute({
        userId: "user-1",
        accountId: account.id,
        membershipNumber: "  ",
      }),
    ).rejects.toBeInstanceOf(InvalidMembershipNumberError);
  });

  it("trims membership numbers like the factory does", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts);

    await new UpdateLoyaltyAccount(accounts).execute({
      userId: "user-1",
      accountId: account.id,
      membershipNumber: "  MP42  ",
    });

    expect(accounts.rows.get(account.id)?.membershipNumber).toBe("MP42");
  });
});

describe("UnlinkLoyaltyAccount", () => {
  it("soft-deletes an owned account so it can be restored", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts);

    await new UnlinkLoyaltyAccount(accounts).execute("user-1", account.id);

    const stored = accounts.rows.get(account.id);
    expect(stored?.deletedAt).not.toBeNull();
    expect(await accounts.findByUserId("user-1")).toHaveLength(0);
  });

  it("hides other users' accounts behind not-found", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const account = seedAccount(accounts);

    await expect(
      new UnlinkLoyaltyAccount(accounts).execute("user-2", account.id),
    ).rejects.toBeInstanceOf(LoyaltyAccountNotFoundError);
    expect(accounts.rows.has(account.id)).toBe(true);
  });

  it("restores a soft-deleted account within the window", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);

    await new UnlinkLoyaltyAccount(accounts).execute("user-1", account.id);
    const restored = await new RestoreLoyaltyAccount(
      accounts,
      balances,
    ).execute("user-1", account.id);

    expect(restored.provider.id).toBe("united");
    expect(accounts.rows.get(account.id)?.deletedAt).toBeNull();
  });
});

describe("RecordManualBalance", () => {
  it("appends a manual snapshot", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);

    const result = await new RecordManualBalance(accounts, balances).execute({
      userId: "user-1",
      accountId: account.id,
      points: 42_000,
    });

    expect(result.points).toBe(42_000);
    expect(result.source).toBe("manual");
    expect(balances.rows).toHaveLength(1);
  });

  it("rejects negative or fractional points", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);
    const useCase = new RecordManualBalance(accounts, balances);

    await expect(
      useCase.execute({ userId: "user-1", accountId: account.id, points: -1 }),
    ).rejects.toBeInstanceOf(InvalidBalanceError);
    await expect(
      useCase.execute({ userId: "user-1", accountId: account.id, points: 1.5 }),
    ).rejects.toBeInstanceOf(InvalidBalanceError);
  });

  it("accepts a backfilled capture time in the past", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);
    const observedAt = new Date("2026-01-15T12:00:00.000Z");

    const result = await new RecordManualBalance(accounts, balances).execute({
      userId: "user-1",
      accountId: account.id,
      points: 1000,
      capturedAt: observedAt,
    });

    expect(result.capturedAt).toEqual(observedAt);
  });

  it("rejects capture times in the future", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    await expect(
      new RecordManualBalance(accounts, balances).execute({
        userId: "user-1",
        accountId: account.id,
        points: 1000,
        capturedAt: future,
      }),
    ).rejects.toBeInstanceOf(InvalidCaptureTimeError);
    expect(balances.rows).toHaveLength(0);
  });

  it("rejects invalid capture timestamps", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);

    await expect(
      new RecordManualBalance(accounts, balances).execute({
        userId: "user-1",
        accountId: account.id,
        points: 1000,
        capturedAt: new Date("not-a-date"),
      }),
    ).rejects.toBeInstanceOf(InvalidCaptureTimeError);
  });
});

describe("GetBalanceHistory", () => {
  it("returns snapshots newest first, clamped to the limit", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const account = seedAccount(accounts);

    for (let day = 1; day <= 5; day++) {
      balances.rows.push(
        createBalanceSnapshot({
          loyaltyAccountId: account.id,
          points: day * 1000,
          source: "sync",
          capturedAt: new Date(2026, 0, day),
        }),
      );
    }

    const history = await new GetBalanceHistory(accounts, balances).execute(
      "user-1",
      account.id,
      3,
    );

    expect(history.map((entry) => entry.points)).toEqual([5000, 4000, 3000]);
  });
});

describe("GetPortfolioSummary", () => {
  it("aggregates totals per provider kind, including credit cards", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const airline = seedAccount(accounts);
    const hotel = seedAccount(accounts, {
      providerId: "marriott",
      membershipNumber: "MB1",
    });
    const card = seedAccount(accounts, {
      providerId: "chase-ultimate-rewards",
      membershipNumber: "UR1",
    });

    balances.rows.push(
      createBalanceSnapshot({
        loyaltyAccountId: airline.id,
        points: 10_000,
        source: "sync",
        capturedAt: new Date(2026, 0, 1),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: hotel.id,
        points: 5_000,
        source: "manual",
        capturedAt: new Date(2026, 0, 2),
      }),
      createBalanceSnapshot({
        loyaltyAccountId: card.id,
        points: 80_000,
        source: "manual",
        capturedAt: new Date(2026, 0, 3),
      }),
    );

    const summary = await new GetPortfolioSummary(
      new ListLoyaltyAccounts(accounts, balances),
    ).execute("user-1");

    expect(summary.totalPoints).toBe(95_000);
    expect(summary.accountCount).toBe(3);
    // Valuations use the catalog's editorial cents-per-point estimates:
    // united 1.2, marriott 0.7, chase-ultimate-rewards 1.6.
    expect(summary.byKind.airline).toEqual({
      accounts: 1,
      points: 10_000,
      valueCents: 12_000,
    });
    expect(summary.byKind.hotel).toEqual({
      accounts: 1,
      points: 5_000,
      valueCents: 3_500,
    });
    expect(summary.byKind.credit_card).toEqual({
      accounts: 1,
      points: 80_000,
      valueCents: 128_000,
    });
    expect(summary.byKind.rail).toEqual({ accounts: 0, points: 0, valueCents: 0 });
    expect(summary.byKind.shopping).toEqual({
      accounts: 0,
      points: 0,
      valueCents: 0,
    });
    expect(summary.totalValueCents).toBe(143_500);
    expect(summary.lastSyncedAt).toEqual(new Date(2026, 0, 3));
  });
});

describe("SyncAllLoyaltyAccounts", () => {
  it("reports per-account outcomes without failing the batch", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const good = seedAccount(accounts);
    const broken = seedAccount(accounts, {
      providerId: "delta",
      membershipNumber: "SK1",
      credentialRef: "op://vault/missing",
    });

    const syncOne = new SyncLoyaltyAccount(
      accounts,
      balances,
      new SimulatedTravelProviderGateway(),
      new FakeCredentialVault({}),
    );
    const outcomes = await new SyncAllLoyaltyAccounts(accounts, syncOne).execute(
      "user-1",
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes.find((o) => o.accountId === good.id)?.ok).toBe(true);
    const failed = outcomes.find((o) => o.accountId === broken.id);
    expect(failed?.ok).toBe(false);
    if (failed && !failed.ok) {
      expect(failed.errorCode).toBe("CREDENTIAL_UNAVAILABLE");
    }
    expect(balances.rows).toHaveLength(1);
  });
});
