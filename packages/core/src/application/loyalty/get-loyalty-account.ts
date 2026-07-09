import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { requireOwnedAccount } from "./access";
import { toLoyaltyAccountReadModel } from "./mappers";
import type { LoyaltyAccountReadModel } from "./read-models";

export class GetLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    userId: string,
    accountId: string,
  ): Promise<LoyaltyAccountReadModel> {
    const account = await requireOwnedAccount(this.accounts, userId, accountId);
    const trends = await this.balances.findTrendContextByAccountIds(
      [account.id],
      this.clock.now(),
    );
    return toLoyaltyAccountReadModel(
      account,
      trends.get(account.id) ?? null,
      this.clock.now(),
    );
  }
}
