import {
  CredentialUnavailableError,
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

export interface SyncLoyaltyAccountInput {
  readonly userId: string;
  readonly accountId: string;
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
    await this.balances.insert(snapshot);

    // Activity resets the inactivity clock for programs that expire.
    await this.accounts.update(refreshExpiryFromActivity(account, now));

    const provider = getProviderOrThrow(account.providerId);
    await recordActivity(this.activity, {
      userId: input.userId,
      type: "balance_synced",
      accountId: account.id,
      providerId: account.providerId,
      summary: `Synced ${provider.displayName}: ${balance.points.toLocaleString("en-US")} ${provider.pointsCurrency}`,
      occurredAt: now,
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
