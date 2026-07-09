import { describe, expect, it } from "vitest";

import { LinkLoyaltyAccount } from "../src/application/loyalty/link-loyalty-account";
import {
  DuplicateLoyaltyAccountError,
  InvalidMembershipNumberError,
  ProviderNotSupportedError,
} from "../src/domain/errors";
import { InMemoryLoyaltyAccountRepository } from "./fakes";

describe("LinkLoyaltyAccount", () => {
  it("links a new account for a supported provider", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const useCase = new LinkLoyaltyAccount(accounts);

    const result = await useCase.execute({
      userId: "user-1",
      providerId: "united",
      membershipNumber: "MP123456",
    });

    const stored = await accounts.findById(result.accountId);
    expect(stored).not.toBeNull();
    expect(stored?.providerId).toBe("united");
    expect(stored?.credentialRef).toBeNull();
  });

  it("rejects unsupported providers", async () => {
    const useCase = new LinkLoyaltyAccount(
      new InMemoryLoyaltyAccountRepository(),
    );

    await expect(
      useCase.execute({
        userId: "user-1",
        providerId: "not-a-real-airline",
        membershipNumber: "X1",
      }),
    ).rejects.toBeInstanceOf(ProviderNotSupportedError);
  });

  it("rejects blank membership numbers", async () => {
    const useCase = new LinkLoyaltyAccount(
      new InMemoryLoyaltyAccountRepository(),
    );

    await expect(
      useCase.execute({
        userId: "user-1",
        providerId: "delta",
        membershipNumber: "   ",
      }),
    ).rejects.toBeInstanceOf(InvalidMembershipNumberError);
  });

  it("rejects linking the same provider twice for one user", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const useCase = new LinkLoyaltyAccount(accounts);

    await useCase.execute({
      userId: "user-1",
      providerId: "hilton",
      membershipNumber: "HH1",
    });

    await expect(
      useCase.execute({
        userId: "user-1",
        providerId: "hilton",
        membershipNumber: "HH2",
      }),
    ).rejects.toBeInstanceOf(DuplicateLoyaltyAccountError);
  });
});
