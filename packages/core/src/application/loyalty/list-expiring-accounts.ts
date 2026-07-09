import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { LoyaltyAccountReadModel } from "./read-models";

export const DEFAULT_EXPIRY_WARNING_DAYS = 90;

/**
 * Accounts whose balances expire within `withinDays` (or have already
 * expired), ordered soonest-first. Programs without an expiry are excluded.
 */
export class ListExpiringAccounts {
  constructor(private readonly listAccounts: ListLoyaltyAccounts) {}

  async execute(
    userId: string,
    withinDays = DEFAULT_EXPIRY_WARNING_DAYS,
  ): Promise<LoyaltyAccountReadModel[]> {
    const accounts = await this.listAccounts.execute(userId);
    return accounts
      .filter(
        (account) =>
          account.daysUntilExpiry !== null &&
          account.daysUntilExpiry <= withinDays,
      )
      .sort(
        (a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0),
      );
  }
}
