import { describe, expect, it } from "vitest";

import { BulkUpdateMembershipNumbers } from "../src/application/loyalty/bulk-update-membership";
import { UpdateLoyaltyAccount } from "../src/application/loyalty/update-loyalty-account";
import { createLoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import { InMemoryLoyaltyAccountRepository } from "./fakes";

function seed(accounts: InMemoryLoyaltyAccountRepository, providerId: string) {
  const account = createLoyaltyAccount({
    userId: "user-1",
    providerId,
    membershipNumber: "OLD",
  });
  accounts.rows.set(account.id, account);
  return account;
}

describe("BulkUpdateMembershipNumbers", () => {
  it("updates every owned account and reports zero failures", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const a = seed(accounts, "united");
    const b = seed(accounts, "delta");
    const useCase = new BulkUpdateMembershipNumbers(
      new UpdateLoyaltyAccount(accounts),
    );

    const result = await useCase.execute({
      userId: "user-1",
      updates: [
        { accountId: a.id, membershipNumber: "MP-NEW" },
        { accountId: b.id, membershipNumber: "DL-NEW" },
      ],
    });

    expect(result.updated).toBe(2);
    expect(result.failures).toEqual([]);
    expect(accounts.rows.get(a.id)?.membershipNumber).toBe("MP-NEW");
    expect(accounts.rows.get(b.id)?.membershipNumber).toBe("DL-NEW");
  });

  it("records a failure for an unknown/unowned account without aborting the batch", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const a = seed(accounts, "united");
    const useCase = new BulkUpdateMembershipNumbers(
      new UpdateLoyaltyAccount(accounts),
    );

    const result = await useCase.execute({
      userId: "user-1",
      updates: [
        { accountId: "does-not-exist", membershipNumber: "X" },
        { accountId: a.id, membershipNumber: "MP-NEW" },
      ],
    });

    expect(result.updated).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      accountId: "does-not-exist",
      code: "LOYALTY_ACCOUNT_NOT_FOUND",
    });
    // The valid item still applied.
    expect(accounts.rows.get(a.id)?.membershipNumber).toBe("MP-NEW");
  });

  it("does not let one user edit another user's account", async () => {
    const accounts = new InMemoryLoyaltyAccountRepository();
    const other = createLoyaltyAccount({
      userId: "user-2",
      providerId: "hyatt",
      membershipNumber: "OWNED-BY-2",
    });
    accounts.rows.set(other.id, other);
    const useCase = new BulkUpdateMembershipNumbers(
      new UpdateLoyaltyAccount(accounts),
    );

    const result = await useCase.execute({
      userId: "user-1",
      updates: [{ accountId: other.id, membershipNumber: "HACK" }],
    });

    expect(result.updated).toBe(0);
    expect(result.failures[0]?.code).toBe("LOYALTY_ACCOUNT_NOT_FOUND");
    expect(accounts.rows.get(other.id)?.membershipNumber).toBe("OWNED-BY-2");
  });
});
