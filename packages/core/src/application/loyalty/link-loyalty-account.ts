import { DuplicateLoyaltyAccountError } from "../../domain/errors";
import { createLoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type {
  ActivityEventRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { recordActivity } from "./list-activity";

export interface LinkLoyaltyAccountInput {
  readonly userId: string;
  readonly providerId: string;
  readonly membershipNumber: string;
  /**
   * Opaque pointer into the user's credential vault (1Password item id,
   * keychain entry name, ...). Optional: accounts can be linked without
   * stored credentials and synced with transient ones.
   */
  readonly credentialRef?: string | null;
}

export interface LinkLoyaltyAccountResult {
  readonly accountId: string;
}

export class LinkLoyaltyAccount {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly activity?: ActivityEventRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    input: LinkLoyaltyAccountInput,
  ): Promise<LinkLoyaltyAccountResult> {
    const existing = await this.accounts.findByUserAndProvider(
      input.userId,
      input.providerId,
    );
    if (existing) {
      throw new DuplicateLoyaltyAccountError(input.providerId);
    }

    const account = createLoyaltyAccount({
      userId: input.userId,
      providerId: input.providerId,
      membershipNumber: input.membershipNumber,
      credentialRef: input.credentialRef,
      now: this.clock.now(),
    });

    await this.accounts.insert(account);

    const provider = getProviderOrThrow(account.providerId);
    await recordActivity(this.activity, {
      userId: input.userId,
      type: "account_linked",
      accountId: account.id,
      providerId: account.providerId,
      summary: `Linked ${provider.displayName}`,
      occurredAt: account.createdAt,
    });

    return { accountId: account.id };
  }
}
