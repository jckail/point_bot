import type { ActivityEventRepository, BalanceSnapshotRepository, LoyaltyAccountRepository } from "../../domain/loyalty/repositories";

/** Repositories scoped to one atomic portfolio mutation, including its feed. */
export interface PortfolioTransaction {
  readonly accounts: LoyaltyAccountRepository;
  readonly balances: BalanceSnapshotRepository;
  readonly activity: ActivityEventRepository;
}

export interface PortfolioUnitOfWork {
  run<T>(userId: string, operation: (repositories: PortfolioTransaction) => Promise<T>): Promise<T>;
}
