import type { CardProductId } from "../../domain/loyalty/card-products";
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
import { requireOwnedAccountForMutation } from "./access";
import { recordActivity } from "./list-activity";

import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
export interface UpdateLoyaltyAccountInput {
  readonly userId: UserId;
  readonly accountId: LoyaltyAccountId;
  /** New membership number; omit to leave unchanged. */
  readonly cardProductId?: CardProductId | null;
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
    await this.eventing.unitOfWork.run(async () => {
      const account = await requireOwnedAccountForMutation(this.accounts, input.userId, input.accountId, this.eventing);
      const now = new Date(Math.max(this.clock.now().getTime(), account.updatedAt.getTime()));
      const updated = applyLoyaltyAccountChanges(account, {
        membershipNumber: input.membershipNumber,
        credentialRef: input.credentialRef,
        cardProductId: input.cardProductId,
        expiresAt: input.expiresAt,
        notes: input.notes,
        tags: input.tags,
        pinnedAt: input.pinned === undefined ? undefined : input.pinned ? now : null,
      }, now);
      const provider = getProviderOrThrow(account.providerId);
      // Field names only; private values never enter the event payload.
      const changed = (["cardProductId", "membershipNumber", "credentialRef", "expiresAt", "notes", "tags", "pinned"] as const)
        .filter(field => input[field] !== undefined);
      await this.accounts.update(updated, { cardProductId: input.cardProductId });
      await recordActivity(this.activity, {
        userId: input.userId, type: "account_updated", accountId: account.id,
        providerId: account.providerId, summary: `Updated ${provider.displayName}`, occurredAt: updated.updatedAt,
      });
      await this.eventing.publisher.publish([createDomainEvent("account.updated", {
        userId: input.userId, aggregateId: account.id, occurredAt: updated.updatedAt,
        payload: { providerId: account.providerId, changed },
      })]);
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

  async execute(userId: UserId, accountId: LoyaltyAccountId): Promise<void> {
    await this.eventing.unitOfWork.run(async () => {
      const account = await requireOwnedAccountForMutation(this.accounts, userId, accountId, this.eventing);
      const provider = getProviderOrThrow(account.providerId);
      const now = new Date(Math.max(this.clock.now().getTime(), account.updatedAt.getTime()));
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
