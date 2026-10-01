import { createDomainEvent } from "../../domain/events";
import {
  createTransferBonus,
  type TransferBonus,
  type TransferBonusRepository,
  type TransferBonusSource,
} from "../../domain/loyalty/transfer-bonus";
import { noopEventing, type Eventing } from "../events/ports";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

export interface RecordTransferBonusInput {
  readonly fromProviderId: string;
  readonly toProviderId: string;
  /** Integer permille: 1300 = +30%. */
  readonly multiplierPermille: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly source: TransferBonusSource;
  readonly sourceUrl?: string | null;
  readonly verifiedAt?: Date | null;
  /** User id of the reporter; null for system / curator entries. */
  readonly createdBy?: string | null;
}

/**
 * Records a time-boxed transfer bonus (global reference data). Validation
 * (catalog ids, edge exists, 1.0 < multiplier <= 3.0, ends after starts)
 * lives in the domain factory. Emits `transfer_bonus.recorded` atomically.
 */
export class RecordTransferBonus {
  constructor(
    private readonly bonuses: TransferBonusRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: RecordTransferBonusInput): Promise<TransferBonus> {
    const now = this.clock.now();
    const bonus = createTransferBonus({ ...input, now });
    await this.eventing.unitOfWork.run(async () => {
      await this.bonuses.insert(bonus);
      await this.eventing.publisher.publish([
        createDomainEvent("transfer_bonus.recorded", {
          userId: bonus.createdBy ?? "system",
          aggregateId: bonus.id,
          occurredAt: now,
          payload: {
            fromProviderId: bonus.fromProviderId,
            toProviderId: bonus.toProviderId,
            multiplierPermille: bonus.multiplierPermille,
            startsAt: bonus.startsAt.toISOString(),
            endsAt: bonus.endsAt.toISOString(),
            source: bonus.source,
          },
        }),
      ]);
    });
    return bonus;
  }
}

/**
 * Whether `viewerId` may see/use a bonus. User-reported bonuses are
 * unverified crowd data: they shape only the reporter's own plans until a
 * trusted party sets `verifiedAt`. Otherwise one user could skew every other
 * user's recommendations with a fake bonus.
 */
export function isBonusVisibleTo(
  bonus: TransferBonus,
  viewerId: string | undefined,
): boolean {
  if (bonus.source !== "user") return true;
  if (bonus.verifiedAt !== null) return true;
  return viewerId !== undefined && bonus.createdBy === viewerId;
}

/**
 * Bonuses whose window contains "now". Empty by default: nothing is invented.
 * Pass the viewing user so their own unverified reports are included; omit it
 * for a trusted-only view (system, scraped, or verified data).
 */
export class ListActiveTransferBonuses {
  constructor(
    private readonly bonuses: TransferBonusRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(viewerId?: string): Promise<TransferBonus[]> {
    const active = await this.bonuses.findActive(this.clock.now());
    return active.filter((bonus) => isBonusVisibleTo(bonus, viewerId));
  }
}
