import {
  toValuationOverrides,
  type CustomValuationRepository,
} from "../../domain/loyalty/custom-valuation";
import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
} from "../../domain/loyalty/repositories";
import { userCacheTag, type Cache } from "../cache";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import { toLoyaltyAccountReadModel } from "./mappers";
import type { LoyaltyAccountReadModel } from "./read-models";

/** Staleness bound for cross-process writes (worker syncs, other instances). */
export const DEFAULT_ACCOUNTS_CACHE_TTL_MS = 10_000;

export class ListLoyaltyAccounts {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
    /** Optional: applies per-user cents-per-point overrides to value. */
    private readonly valuations?: CustomValuationRepository,
    /**
     * Optional read-through cache. Writers must invalidate `userCacheTag(userId)`
     * after committing (the web container does this for every mutating use
     * case); `cacheTtlMs` bounds staleness for writes made by other processes.
     */
    private readonly cache?: Cache,
    private readonly cacheTtlMs = DEFAULT_ACCOUNTS_CACHE_TTL_MS,
  ) {}

  async execute(userId: string): Promise<LoyaltyAccountReadModel[]> {
    if (!this.cache || this.cacheTtlMs <= 0) return this.load(userId);
    // Callers get their own array (the cached one is shared and must stay
    // untouched); the read models inside are treated as immutable.
    const accounts = await this.cache.remember(
      `accounts:${userId}`,
      { ttlMs: this.cacheTtlMs, tags: [userCacheTag(userId)] },
      () => this.load(userId),
    );
    return [...accounts];
  }

  private async load(userId: string): Promise<LoyaltyAccountReadModel[]> {
    const accounts = await this.accounts.findByUserId(userId);
    const [trends, overrides] = await Promise.all([
      this.balances.findTrendContextByAccountIds(
        accounts.map((account) => account.id),
        this.clock.now(),
      ),
      this.valuations
        ? this.valuations.listForUser(userId).then(toValuationOverrides)
        : Promise.resolve(new Map<string, number>()),
    ]);

    const now = this.clock.now();
    return accounts.map((account) =>
      toLoyaltyAccountReadModel(account, trends.get(account.id) ?? null, now, overrides),
    );
  }
}
