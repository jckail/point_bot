import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import { InvalidCaptureTimeError, LoyaltyAccountNotFoundError } from "../../domain/errors";
import { createBalanceSnapshot, type BalanceSource } from "../../domain/loyalty/balance-snapshot";
import { refreshExpiryFromActivity } from "../../domain/loyalty/loyalty-account";
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

import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
export interface RecordManualBalanceInput {
  readonly userId: UserId;
  readonly accountId: LoyaltyAccountId;
  readonly points: number;
  /**
   * When the user actually observed this balance; omit for "now". Backfilled
   * entries must not be in the future.
   */
  readonly capturedAt?: Date;
  /** Provenance; agent write-back passes "agent". Defaults to "manual". */
  readonly source?: Extract<BalanceSource, "manual" | "agent">;
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
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: RecordManualBalanceInput): Promise<BalanceReadModel> {
    return (await this.executeWithSnapshotId(input)).balance;
  }

  /** Internal provenance witness: the exact inserted row, including backfills. */
  executeWithSnapshotId(input: RecordManualBalanceInput): Promise<{ balance: BalanceReadModel; snapshotId: string }> {
    return this.eventing.unitOfWork.run(async () => {
      const account = this.accounts.lockById
        ? await this.accounts.lockById(input.accountId)
        : await requireOwnedAccount(this.accounts, input.userId, input.accountId);
      if (!account || account.userId !== input.userId || account.deletedAt) {
        throw new LoyaltyAccountNotFoundError(input.accountId);
      }

      const now = this.clock.now();
      if (input.capturedAt && input.capturedAt.getTime() > now.getTime()) {
        throw new InvalidCaptureTimeError("capture time is in the future");
      }

      const capturedAt = input.capturedAt ?? now;
      const snapshot = createBalanceSnapshot({
        loyaltyAccountId: account.id,
        points: input.points,
        source: input.source ?? "manual",
        capturedAt,
      });
      const provider = getProviderOrThrow(account.providerId);
      const viaAgent = input.source === "agent";

      const previous = (await this.balances.findLatestByAccountIds([account.id])).get(
        account.id,
      );
      await this.balances.insert(snapshot);

      // Preserve PR14's activity-derived expiry refresh for forward readings.
      // Historical captures must not overwrite a newer balance or account
      // metadata change (including explicit expiry overrides and cleared expiry).
      const historical = capturedAt.getTime() < account.updatedAt.getTime()
        || (previous !== undefined && capturedAt.getTime() < previous.capturedAt.getTime());
      const refreshed = historical ? account : refreshExpiryFromActivity(account, capturedAt);
      const mutationTime = this.clock.now();
      await this.accounts.update({
        ...refreshed,
        // Metadata records transaction time, never a backfilled capture time.
        // Keep a stored future timestamp rather than silently repairing history.
        updatedAt: new Date(Math.max(mutationTime.getTime(), account.updatedAt.getTime())),
      });

      await recordActivity(this.activity, {
        userId: input.userId,
        type: viaAgent ? "balance_agent" : "balance_manual",
        accountId: account.id,
        providerId: account.providerId,
        summary: `${viaAgent ? "Agent read" : "Recorded"} ${provider.displayName}: ${input.points.toLocaleString("en-US")} ${provider.pointsCurrency}`,
        occurredAt: capturedAt,
      });
      await this.eventing.publisher.publish([
        createDomainEvent("balance.recorded", {
          userId: input.userId,
          aggregateId: account.id,
          occurredAt: now,
          payload: {
            accountId: account.id,
            providerId: account.providerId,
            points: snapshot.points,
            previousPoints: previous?.points ?? null,
            source: snapshot.source,
            capturedAt: capturedAt.toISOString(),
          },
        }),
      ]);

      return { balance: toBalanceReadModel(snapshot), snapshotId: snapshot.id };
    });
  }
}
