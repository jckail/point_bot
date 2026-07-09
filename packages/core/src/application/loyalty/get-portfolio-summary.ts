import type { ProviderKind } from "../../domain/loyalty/provider";
import { PROVIDER_KINDS } from "../../domain/loyalty/provider";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { LoyaltyAccountReadModel } from "./read-models";

export interface KindSummary {
  readonly accounts: number;
  readonly points: number;
  /** Approximate USD value, in whole cents. */
  readonly valueCents: number;
}

export interface PortfolioSummaryReadModel {
  readonly totalPoints: number;
  /** Approximate USD value of the whole portfolio, in whole cents. */
  readonly totalValueCents: number;
  readonly accountCount: number;
  readonly byKind: Record<ProviderKind, KindSummary>;
  readonly lastSyncedAt: Date | null;
}

/**
 * Pure fold over account read models. Exposed separately so callers that
 * already have the accounts (digest job, dashboard) can aggregate without a
 * second round of queries.
 */
export function computePortfolioSummary(
  accounts: readonly LoyaltyAccountReadModel[],
): PortfolioSummaryReadModel {
  const byKind = Object.fromEntries(
    PROVIDER_KINDS.map((kind) => [
      kind,
      { accounts: 0, points: 0, valueCents: 0 },
    ]),
  ) as Record<ProviderKind, { accounts: number; points: number; valueCents: number }>;

  let totalPoints = 0;
  let totalValueCents = 0;
  let lastSyncedAt: Date | null = null;

  for (const account of accounts) {
    const points = account.latestBalance?.points ?? 0;
    const kind = byKind[account.provider.kind];

    kind.accounts += 1;
    kind.points += points;
    kind.valueCents += account.estimatedValueCents;
    totalPoints += points;
    totalValueCents += account.estimatedValueCents;

    const capturedAt = account.latestBalance?.capturedAt;
    if (capturedAt && (!lastSyncedAt || capturedAt > lastSyncedAt)) {
      lastSyncedAt = capturedAt;
    }
  }

  return {
    totalPoints,
    totalValueCents,
    accountCount: accounts.length,
    byKind,
    lastSyncedAt,
  };
}

/** Aggregated view of a user's whole points portfolio. */
export class GetPortfolioSummary {
  constructor(private readonly listAccounts: ListLoyaltyAccounts) {}

  async execute(userId: string): Promise<PortfolioSummaryReadModel> {
    return computePortfolioSummary(await this.listAccounts.execute(userId));
  }
}
