import type { PortfolioUnitOfWork } from "./portfolio-unit-of-work";
import { InvalidCaptureTimeError } from "../../domain/errors";
import { createBalanceSnapshot } from "../../domain/loyalty/balance-snapshot";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { requireOwnedAccount } from "./access";
import { recordActivity } from "./list-activity";
import { toBalanceReadModel } from "./mappers";
import type { BalanceReadModel } from "./read-models";

export interface RecordManualBalanceInput {
  readonly userId: string;
  readonly accountId: string;
  readonly points: number;
  /**
   * When the user actually observed this balance; omit for "now". Backfilled
   * entries must not be in the future.
   */
  readonly capturedAt?: Date;
}

/**
 * Users can key in a balance they see on the provider's site - useful for
 * programs without an integration or credentials on file.
 */
export class RecordManualBalance {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
    private readonly unitOfWork?: PortfolioUnitOfWork,
  ) {}

  async execute(input: RecordManualBalanceInput): Promise<BalanceReadModel> {
    if (this.unitOfWork) {
      return this.unitOfWork.run(input.userId, ({ accounts, balances, activity }) =>
        new RecordManualBalance(accounts, balances, activity, this.clock).execute(input));
    }
    const account = await requireOwnedAccount(
      this.accounts,
      input.userId,
      input.accountId,
    );

    const now = this.clock.now();
    if (input.capturedAt && input.capturedAt.getTime() > now.getTime()) {
      throw new InvalidCaptureTimeError("capture time is in the future");
    }

    const capturedAt = input.capturedAt ?? now;
    const snapshot = createBalanceSnapshot({
      loyaltyAccountId: account.id,
      points: input.points,
      source: "manual",
      capturedAt,
    });
    await this.balances.insert(snapshot);

    // Observing a balance is not a qualifying earn/redeem transaction.
    // Preserve the provider/user expiry, including when backfilling history.

    const provider = getProviderOrThrow(account.providerId);
    await recordActivity(this.activity, {
      userId: input.userId,
      type: "balance_manual",
      accountId: account.id,
      providerId: account.providerId,
      summary: `Recorded ${provider.displayName}: ${input.points.toLocaleString("en-US")} ${provider.pointsCurrency}`,
      occurredAt: capturedAt,
    });

    return toBalanceReadModel(snapshot);
  }
}
