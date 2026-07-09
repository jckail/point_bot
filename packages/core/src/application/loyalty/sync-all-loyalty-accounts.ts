import { DomainError } from "../../domain/errors";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { BalanceReadModel } from "./read-models";
import type { SyncLoyaltyAccount } from "./sync-loyalty-account";

export type SyncOutcome =
  | { readonly accountId: string; readonly ok: true; readonly balance: BalanceReadModel }
  | { readonly accountId: string; readonly ok: false; readonly errorCode: string };

/**
 * Best-effort sync of every account a user has linked. One failing provider
 * (missing credentials, unsupported program) never blocks the rest; each
 * account reports its own outcome.
 */
export class SyncAllLoyaltyAccounts {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly syncOne: SyncLoyaltyAccount,
  ) {}

  async execute(userId: string): Promise<SyncOutcome[]> {
    const accounts = await this.accounts.findByUserId(userId);

    const outcomes: SyncOutcome[] = [];
    for (const account of accounts) {
      try {
        const balance = await this.syncOne.execute({
          userId,
          accountId: account.id,
        });
        outcomes.push({ accountId: account.id, ok: true, balance });
      } catch (error) {
        if (error instanceof DomainError) {
          outcomes.push({ accountId: account.id, ok: false, errorCode: error.code });
          continue;
        }
        throw error;
      }
    }
    return outcomes;
  }
}
