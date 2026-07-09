import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import { requireOwnedAccount } from "./access";
import { toBalanceReadModel } from "./mappers";
import type { BalanceReadModel } from "./read-models";

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 365;

export class GetBalanceHistory {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
  ) {}

  /** Returns snapshots newest-first. */
  async execute(
    userId: string,
    accountId: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<BalanceReadModel[]> {
    const account = await requireOwnedAccount(this.accounts, userId, accountId);
    const clamped = Math.min(Math.max(1, limit), MAX_HISTORY_LIMIT);
    const snapshots = await this.balances.findByAccountId(account.id, clamped);
    return snapshots.map(toBalanceReadModel);
  }
}
