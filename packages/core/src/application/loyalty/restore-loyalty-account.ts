import {
  AccountNotRestorableError,
} from "../../domain/errors";
import {
  isWithinRestoreWindow,
  restoreLoyaltyAccount,
} from "../../domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { requireOwnedAccountIncludingDeleted } from "./access";
import { recordActivity } from "./list-activity";
import { toLoyaltyAccountReadModel } from "./mappers";
import type { LoyaltyAccountReadModel } from "./read-models";

/**
 * Restores a soft-deleted account within the undo window. Outside the window
 * the account is treated as gone.
 */
export class RestoreLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    userId: string,
    accountId: string,
  ): Promise<LoyaltyAccountReadModel> {
    const account = await requireOwnedAccountIncludingDeleted(
      this.accounts,
      userId,
      accountId,
    );

    if (!account.deletedAt) {
      throw new AccountNotRestorableError("account is not deleted");
    }

    const now = this.clock.now();
    if (!isWithinRestoreWindow(account, now)) {
      throw new AccountNotRestorableError("restore window has expired");
    }

    const restored = restoreLoyaltyAccount(account, now);
    await this.accounts.update(restored);

    const provider = getProviderOrThrow(account.providerId);
    await recordActivity(this.activity, {
      userId,
      type: "account_restored",
      accountId: account.id,
      providerId: account.providerId,
      summary: `Restored ${provider.displayName}`,
      occurredAt: now,
    });

    const trends = await this.balances.findTrendContextByAccountIds(
      [account.id],
      now,
    );
    return toLoyaltyAccountReadModel(
      restored,
      trends.get(account.id) ?? null,
      now,
    );
  }
}

export class ListDeletedLoyaltyAccounts {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string): Promise<
    Array<{
      readonly id: string;
      readonly providerId: string;
      readonly providerName: string;
      readonly deletedAt: Date;
      readonly restorable: boolean;
    }>
  > {
    const deleted = await this.accounts.findDeletedByUserId(userId);
    const now = this.clock.now();
    return deleted
      .filter((account) => account.deletedAt)
      .map((account) => {
        const provider = getProviderOrThrow(account.providerId);
        return {
          id: account.id,
          providerId: account.providerId,
          providerName: provider.displayName,
          deletedAt: account.deletedAt!,
          restorable: isWithinRestoreWindow(account, now),
        };
      });
  }
}

/** Hard-purge soft-deleted accounts whose restore window has elapsed. */
export class PurgeExpiredUnlinks {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string): Promise<number> {
    const deleted = await this.accounts.findDeletedByUserId(userId);
    const now = this.clock.now();
    let purged = 0;
    for (const account of deleted) {
      if (!isWithinRestoreWindow(account, now)) {
        await this.accounts.delete(account.id);
        purged += 1;
      }
    }
    return purged;
  }
}
