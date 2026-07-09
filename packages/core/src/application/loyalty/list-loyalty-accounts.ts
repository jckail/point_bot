import {
  toValuationOverrides,
  type CustomValuationRepository,
} from "../../domain/loyalty/custom-valuation";
import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { toLoyaltyAccountReadModel } from "./mappers";
import type { LoyaltyAccountReadModel } from "./read-models";

export class ListLoyaltyAccounts {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
    /** Optional: applies per-user cents-per-point overrides to value. */
    private readonly valuations?: CustomValuationRepository,
  ) {}

  async execute(userId: string): Promise<LoyaltyAccountReadModel[]> {
    const accounts = await this.accounts.findByUserId(userId);
    const [trends, overrides] = await Promise.all([
      this.balances.findTrendContextByAccountIds(
        accounts.map((account) => account.id),
        this.clock.now(),
      ),
      this.valuations
        ? this.valuations.listForUser(userId).then(toValuationOverrides)
        : Promise.resolve(new Map<string, number>()),
    ]);

    return accounts.map((account) =>
      toLoyaltyAccountReadModel(
        account,
        trends.get(account.id) ?? null,
        this.clock.now(),
        overrides,
      ),
    );
  }
}
