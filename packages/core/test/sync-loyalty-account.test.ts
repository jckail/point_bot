import { describe, expect, it } from "vitest";

import { SyncLoyaltyAccount } from "../src/application/loyalty/sync-loyalty-account";
import {
  CredentialUnavailableError,
  LoyaltyAccountNotFoundError,
} from "../src/domain/errors";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { SimulatedTravelProviderGateway } from "../src/infrastructure/providers/simulated-travel-provider-gateway";
import {
  FakeCredentialVault,
  InMemoryBalanceSnapshotRepository,
  InMemoryLoyaltyAccountRepository,
} from "./fakes";

function makeSut(vault = new FakeCredentialVault()) {
  const accounts = new InMemoryLoyaltyAccountRepository();
  const balances = new InMemoryBalanceSnapshotRepository();
  const useCase = new SyncLoyaltyAccount(
    accounts,
    balances,
    new SimulatedTravelProviderGateway(),
    vault,
  );
  return { accounts, balances, useCase };
}

describe("SyncLoyaltyAccount", () => {
  it("records a balance snapshot for the owner", async () => {
    const { accounts, balances, useCase } = makeSut();
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP123456",
    });
    await accounts.insert(account);

    const result = await useCase.execute({
      userId: "user-1",
      accountId: account.id,
    });

    expect(result.points).toBeGreaterThanOrEqual(0);
    expect(balances.rows).toHaveLength(1);
    expect(balances.rows[0]?.source).toBe("sync");
  });

  it("hides other users' accounts behind not-found", async () => {
    const { accounts, useCase } = makeSut();
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "marriott",
      membershipNumber: "MB1",
    });
    await accounts.insert(account);

    await expect(
      useCase.execute({ userId: "user-2", accountId: account.id }),
    ).rejects.toBeInstanceOf(LoyaltyAccountNotFoundError);
  });

  it("fails when a stored credential ref cannot be resolved", async () => {
    const { accounts, useCase } = makeSut(new FakeCredentialVault({}));
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "delta",
      membershipNumber: "SK1",
      credentialRef: "op://vault/missing-item",
    });
    await accounts.insert(account);

    await expect(
      useCase.execute({ userId: "user-1", accountId: account.id }),
    ).rejects.toBeInstanceOf(CredentialUnavailableError);
  });

  it("prefers a transient credential from the calling surface", async () => {
    const { accounts, balances, useCase } = makeSut(
      new FakeCredentialVault({}),
    );
    const account = createLoyaltyAccount({
      userId: "user-1",
      providerId: "delta",
      membershipNumber: "SK1",
      credentialRef: "op://vault/missing-item",
    });
    await accounts.insert(account);

    await useCase.execute({
      userId: "user-1",
      accountId: account.id,
      transientCredential: { username: "u", secret: "s" },
    });

    expect(balances.rows).toHaveLength(1);
  });
});
