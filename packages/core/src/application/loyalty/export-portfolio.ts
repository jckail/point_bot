import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { toBalanceReadModel, toLoyaltyAccountReadModel } from "./mappers";
import type {
  BalanceReadModel,
  LoyaltyAccountReadModel,
} from "./read-models";

export interface ExportedAccount {
  readonly account: LoyaltyAccountReadModel;
  /** Full history, newest first (capped). */
  readonly history: BalanceReadModel[];
}

export interface PortfolioExportReadModel {
  readonly exportedAt: Date;
  readonly accounts: ExportedAccount[];
}

export const DEFAULT_EXPORT_HISTORY_LIMIT = 365;

/**
 * Assembles a portable dump of a user's accounts and balance history - the
 * payload behind `GET /api/v1/export`. Surfaces can serialize it as JSON or
 * flatten it to CSV.
 */
export class ExportPortfolio {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    userId: string,
    historyLimit = DEFAULT_EXPORT_HISTORY_LIMIT,
  ): Promise<PortfolioExportReadModel> {
    const accounts = await this.accounts.findByUserId(userId);
    const now = this.clock.now();
    const trends = await this.balances.findTrendContextByAccountIds(
      accounts.map((account) => account.id),
      now,
    );

    const exported: ExportedAccount[] = [];
    for (const account of accounts) {
      const history = await this.balances.findByAccountId(
        account.id,
        historyLimit,
      );
      exported.push({
        account: toLoyaltyAccountReadModel(
          account,
          trends.get(account.id) ?? null,
          now,
        ),
        history: history.map(toBalanceReadModel),
      });
    }

    return { exportedAt: now, accounts: exported };
  }
}
