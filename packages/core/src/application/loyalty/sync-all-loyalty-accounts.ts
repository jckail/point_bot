import { DomainError, type ErrorCode } from "../../domain/errors";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { BalanceReadModel } from "./read-models";
import type { SyncLoyaltyAccount } from "./sync-loyalty-account";

import type { LoyaltyAccountId, UserId } from "../../domain/shared/ids";
export type SyncOutcome =
  | { readonly accountId: LoyaltyAccountId; readonly ok: true; readonly balance: BalanceReadModel }
  | { readonly accountId: LoyaltyAccountId; readonly ok: false; readonly errorCode: ErrorCode };

export const DEFAULT_SYNC_CONCURRENCY = 4;

/**
 * Best-effort sync of every account a user has linked. One failing provider
 * (missing credentials, unsupported program) never blocks the rest; each
 * account reports its own outcome.
 */
export class SyncAllLoyaltyAccounts {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly syncOne: SyncLoyaltyAccount,
    /**
     * How many accounts of one user sync at once. Provider fetches are
     * network-bound, so a small fan-out cuts wall time roughly by this factor
     * (see docs/performance.md); keep it below the DB pool size and mindful of
     * provider rate limits. 1 restores strictly sequential behaviour.
     */
    private readonly concurrency = DEFAULT_SYNC_CONCURRENCY,
  ) {}

  async execute(userId: UserId): Promise<SyncOutcome[]> {
    const accounts = await this.accounts.findByUserId(userId);

    // Results land at their account's index, so output order is the same as
    // the sequential version regardless of completion order.
    const outcomes = new Array<SyncOutcome>(accounts.length);
    let next = 0;
    let failure: unknown;
    let failed = false;
    const worker = async () => {
      while (!failed) {
        const index = next++;
        const account = accounts[index];
        if (!account) return;
        try {
          const balance = await this.syncOne.execute({
            userId,
            accountId: account.id,
          });
          outcomes[index] = { accountId: account.id, ok: true, balance };
        } catch (error) {
          if (error instanceof DomainError) {
            outcomes[index] = { accountId: account.id, ok: false, errorCode: error.code };
            continue;
          }
          // Unexpected (non-domain) error: stop handing out work and rethrow.
          failed = true;
          failure = error;
          return;
        }
      }
    };
    const width = Math.max(1, Math.min(this.concurrency, accounts.length));
    await Promise.all(Array.from({ length: width }, worker));
    if (failed) throw failure;
    return outcomes;
  }
}
