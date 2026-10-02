import { describe, expect, it } from "vitest";

import {
  DeleteCustomValuation,
  ListCustomValuations,
  SetCustomValuation,
} from "../src/application/loyalty/custom-valuations";
import { ListLoyaltyAccounts } from "../src/application/loyalty/list-loyalty-accounts";
import {
  InvalidValuationError,
  ProviderNotSupportedError,
} from "../src/domain/errors";
import { createBalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import {
  InMemoryBalanceSnapshotRepository,
  InMemoryCustomValuationRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

import { asUserId } from "./ids";
function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

describe("SetCustomValuation", () => {
  it("rejects unknown providers", async () => {
    const repo = new InMemoryCustomValuationRepository();
    await expect(
      new SetCustomValuation(repo).execute({
        userId: asUserId("u"),
        providerId: "not-a-real-provider",
        centsPerPoint: 2,
      }),
    ).rejects.toBeInstanceOf(ProviderNotSupportedError);
  });

  it("rejects out-of-range cents-per-point", async () => {
    const repo = new InMemoryCustomValuationRepository();
    for (const bad of [0, 0.0001, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        new SetCustomValuation(repo).execute({
          userId: asUserId("u"),
          providerId: "united",
          centsPerPoint: bad,
        }),
      ).rejects.toBeInstanceOf(InvalidValuationError);
    }
  });

  it("returns and persists the same normalized milli-cents value", async () => {
    const repo = new InMemoryCustomValuationRepository();
    const result = await new SetCustomValuation(repo).execute({
      userId: asUserId("u"), providerId: "united", centsPerPoint: 1.2345,
    });
    expect(result.centsPerPoint).toBe(1.235);
    expect(await new ListCustomValuations(repo).execute(asUserId("u"))).toEqual([result]);
  });

  it("upserts a valuation with the clock's timestamp", async () => {
    const repo = new InMemoryCustomValuationRepository();
    const set = new SetCustomValuation(repo, fixedClock("2026-02-01T00:00:00Z"));
    await set.execute({ userId: asUserId("u"), providerId: "united", centsPerPoint: 2.1 });
    await set.execute({ userId: asUserId("u"), providerId: "united", centsPerPoint: 2.5 });

    const all = await new ListCustomValuations(repo).execute(asUserId("u"));
    expect(all).toHaveLength(1); // upsert, not duplicate
    expect(all[0]).toMatchObject({ providerId: "united", centsPerPoint: 2.5 });
  });
});

describe("custom valuations affect portfolio value", () => {
  async function setup() {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const balances = new InMemoryBalanceSnapshotRepository();
    const valuations = new InMemoryCustomValuationRepository();

    const account = createLoyaltyAccount({
      userId: asUserId("u"),
      providerId: "united", // editorial 1.2¢/pt
      membershipNumber: "MP1",
    });
    accounts.rows.set(account.id, account);
    await balances.insert(
      createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: 100_000,
        source: "manual",
        capturedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    return { accounts, balances, valuations };
  }

  it("uses the editorial rate when no override is set", async () => {
    const { accounts, balances, valuations } = await setup();
    const [read] = await new ListLoyaltyAccounts(
      accounts,
      balances,
      undefined,
      valuations,
    ).execute(asUserId("u"));
    expect(read!.estimatedValueCents).toBe(120_000); // 100k * 1.2
    expect(read!.customCentsPerPoint).toBeNull();
  });

  it("uses the override when set, and reverts after delete", async () => {
    const { accounts, balances, valuations } = await setup();
    await new SetCustomValuation(valuations).execute({
      userId: asUserId("u"),
      providerId: "united",
      centsPerPoint: 2,
    });

    const list = new ListLoyaltyAccounts(accounts, balances, undefined, valuations);
    let [read] = await list.execute(asUserId("u"));
    expect(read!.estimatedValueCents).toBe(200_000); // 100k * 2.0 override
    expect(read!.customCentsPerPoint).toBe(2);

    await new DeleteCustomValuation(valuations).execute(asUserId("u"), "united");
    [read] = await list.execute(asUserId("u"));
    expect(read!.estimatedValueCents).toBe(120_000); // back to editorial
    expect(read!.customCentsPerPoint).toBeNull();
  });
});
