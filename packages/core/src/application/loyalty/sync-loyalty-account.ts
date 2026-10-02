import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import {
  CredentialUnavailableError,
  LoyaltyAccountNotFoundError,
  ProviderNotSupportedError,
} from "../../domain/errors";
import { createBalanceSnapshot } from "../../domain/loyalty/balance-snapshot";
import { refreshExpiryFromActivity } from "../../domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type {
  Clock,
  CredentialVault,
  ProviderCredential,
  TravelProviderGateway,
} from "../ports";
import { systemClock } from "../ports";
import { requireOwnedAccount } from "./access";
import { recordActivity } from "./list-activity";
import type { BalanceReadModel } from "./read-models";

import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
export interface SyncLoyaltyAccountInput {
  readonly userId: UserId;
  readonly accountId: LoyaltyAccountId;
  /**
   * Credential resolved on the calling surface (e.g. from Apple Keychain on
   * mobile or the Chrome password manager in an extension). Takes precedence
   * over the account's stored `credentialRef`. Used once, never persisted.
   */
  readonly transientCredential?: ProviderCredential;
}

export class SyncLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly gateway: TravelProviderGateway,
    private readonly vault: CredentialVault,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: SyncLoyaltyAccountInput): Promise<BalanceReadModel> {
    const account = await requireOwnedAccount(
      this.accounts,
      input.userId,
      input.accountId,
    );

    if (!this.gateway.supports(account.providerId)) {
      throw new ProviderNotSupportedError(account.providerId);
    }

    const credential = await this.resolveCredential(account.credentialRef, input);
    const balance = await this.gateway.fetchBalance(account, credential);
    const now = this.clock.now();

    const snapshot = createBalanceSnapshot({
      loyaltyAccountId: account.id,
      points: balance.points,
      source: "sync",
      capturedAt: now,
    });
    const provider = getProviderOrThrow(account.providerId);

    await this.eventing.unitOfWork.run(async () => {
      // Provider IO stays outside the transaction; refresh the account under
      // the same serialization boundary as manual and observation writers.
      const current = this.accounts.lockById
        ? await this.accounts.lockById(input.accountId)
        : await requireOwnedAccount(this.accounts, input.userId, input.accountId);
      if (!current || current.userId !== input.userId || current.deletedAt) {
        throw new LoyaltyAccountNotFoundError(input.accountId);
      }
      if (current.providerId !== account.providerId || current.membershipNumber !== account.membershipNumber
          || current.credentialRef !== account.credentialRef) {
        throw new CredentialUnavailableError("Account details changed while syncing; retry with the current account.");
      }
      const previous = (await this.balances.findLatestByAccountIds([account.id])).get(
        account.id,
      );
      await this.balances.insert(snapshot);

      // Provider capture happened before the account lock. A concurrent newer
      // reading or metadata edit must retain its expiry, including explicit NULL.
      const historical = now.getTime() < current.updatedAt.getTime()
        || (previous !== undefined && now.getTime() < previous.capturedAt.getTime());
      const refreshed = historical ? current : refreshExpiryFromActivity(current, now);
      const mutationTime = this.clock.now();
      await this.accounts.update({
        ...refreshed,
        updatedAt: new Date(Math.max(mutationTime.getTime(), current.updatedAt.getTime())),
      });

      await recordActivity(this.activity, {
        userId: input.userId,
        type: "balance_synced",
        accountId: account.id,
        providerId: account.providerId,
        summary: `Synced ${provider.displayName}: ${balance.points.toLocaleString("en-US")} ${provider.pointsCurrency}`,
        occurredAt: now,
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
            source: "sync",
            capturedAt: now.toISOString(),
          },
        }),
      ]);
    });

    return {
      points: snapshot.points,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
    };
  }

  private async resolveCredential(
    credentialRef: string | null,
    input: SyncLoyaltyAccountInput,
  ): Promise<ProviderCredential | null> {
    if (input.transientCredential) {
      return input.transientCredential;
    }

    if (credentialRef) {
      const credential = await this.vault.resolve(credentialRef);
      if (!credential) {
        throw new CredentialUnavailableError(
          `vault has no entry for ref "${credentialRef}"`,
        );
      }
      return credential;
    }

    return null;
  }
}
