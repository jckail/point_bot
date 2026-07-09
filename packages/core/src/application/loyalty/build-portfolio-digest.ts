import {
  computePortfolioSummary,
  type PortfolioSummaryReadModel,
} from "./get-portfolio-summary";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { ListTripGoals } from "./list-trip-goals";
import type { TripGoalReadModel } from "./create-trip-goal";
import type { LoyaltyAccountReadModel } from "./read-models";
import { DEFAULT_EXPIRY_WARNING_DAYS } from "./list-expiring-accounts";

export interface PortfolioDigestReadModel {
  readonly userId: string;
  readonly summary: PortfolioSummaryReadModel;
  /** Accounts ordered by estimated value, most valuable first. */
  readonly accounts: LoyaltyAccountReadModel[];
  /** Active trip goals with progress. */
  readonly goals: TripGoalReadModel[];
  /** Accounts expiring within the warning window. */
  readonly expiring: LoyaltyAccountReadModel[];
}

/**
 * Assembles everything a periodic digest (email, push notification) needs in
 * one read model, from a single repository pass. Rendering is the delivery
 * surface's job; this stays pure so any channel can reuse it.
 */
export class BuildPortfolioDigest {
  constructor(
    private readonly listAccounts: ListLoyaltyAccounts,
    private readonly listGoals?: ListTripGoals,
  ) {}

  async execute(userId: string): Promise<PortfolioDigestReadModel> {
    const accounts = await this.listAccounts.execute(userId);
    const goals = this.listGoals
      ? (await this.listGoals.execute(userId)).filter(
          (goal) => goal.status === "active",
        )
      : [];

    const expiring = accounts
      .filter(
        (account) =>
          account.daysUntilExpiry !== null &&
          account.daysUntilExpiry <= DEFAULT_EXPIRY_WARNING_DAYS,
      )
      .sort(
        (a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0),
      );

    return {
      userId,
      summary: computePortfolioSummary(accounts),
      accounts: [...accounts].sort(
        (a, b) => b.estimatedValueCents - a.estimatedValueCents,
      ),
      goals,
      expiring,
    };
  }
}
