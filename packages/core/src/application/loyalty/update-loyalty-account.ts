import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import {
  applyLoyaltyAccountChanges,
  softDeleteLoyaltyAccount,
} from "../../domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type {
  ActivityEventRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { requireOwnedAccount } from "./access";
import { recordActivity } from "./list-activity";

export interface UpdateLoyaltyAccountInput {
  readonly userId: string;
  readonly accountId: string;
  /** New membership number; omit to leave unchanged. */
  readonly membershipNumber?: string;
  /** New credential ref; `null` clears it, omit to leave unchanged. */
  readonly credentialRef?: string | null;
  /** New expiry; `null` clears it, omit to leave unchanged. */
  readonly expiresAt?: Date | null;
  /** Free-text notes; `null` clears. */
  readonly notes?: string | null;
  /** Replace the full tag set. */
  readonly tags?: readonly string[];
  /**
   * Pin control: `true` pins (sets pinnedAt to now), `false` unpins,
   * omit leaves unchanged.
   */
  readonly pinned?: boolean;
}

export class UpdateLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: UpdateLoyaltyAccountInput): Promise<void> {
    const account = await requireOwnedAccount(
      this.accounts,
      input.userId,
      input.accountId,
    );

    const now = this.clock.now();
    const pinnedAt =
      input.pinned === undefined
        ? undefined
        : input.pinned
          ? now
          : null;

    const updated = applyLoyaltyAccountChanges(
      account,
      {
        membershipNumber: input.membershipNumber,
        credentialRef: input.credentialRef,
        expiresAt: input.expiresAt,
        notes: input.notes,
        tags: input.tags,
        pinnedAt,
      },
      now,
    );
    const provider = getProviderOrThrow(account.providerId);
    // Field names only; values (membership number, credential ref) never
    // leave the aggregate.
    const changed = (
      [
        "membershipNumber",
        "credentialRef",
        "expiresAt",
        "notes",
        "tags",
        "pinned",
      ] as const
    ).filter((field) => input[field] !== undefined);
    await this.eventing.unitOfWork.run(async () => {
      await this.accounts.update(updated);
      await recordActivity(this.activity, {
        userId: input.userId,
        type: "account_updated",
        accountId: account.id,
        providerId: account.providerId,
        summary: `Updated ${provider.displayName}`,
        occurredAt: updated.updatedAt,
      });
      await this.eventing.publisher.publish([
        createDomainEvent("account.updated", {
          userId: input.userId,
          aggregateId: account.id,
          occurredAt: updated.updatedAt,
          payload: { providerId: account.providerId, changed },
        }),
      ]);
    });
  }
}

/**
 * Soft-deletes an account so the user can undo within the restore window.
 * Balance history is retained until a hard purge.
 */
export class UnlinkLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(userId: string, accountId: string): Promise<void> {
    const account = await requireOwnedAccount(this.accounts, userId, accountId);
    const provider = getProviderOrThrow(account.providerId);
    const now = this.clock.now();
    await this.eventing.unitOfWork.run(async () => {
      await this.accounts.update(softDeleteLoyaltyAccount(account, now));
      await recordActivity(this.activity, {
        userId,
        type: "account_unlinked",
        accountId: account.id,
        providerId: account.providerId,
        summary: `Unlinked ${provider.displayName}`,
        occurredAt: now,
      });
      await this.eventing.publisher.publish([
        createDomainEvent("account.unlinked", {
          userId,
          aggregateId: account.id,
          occurredAt: now,
          payload: { providerId: account.providerId },
        }),
      ]);
    });
  }
}
