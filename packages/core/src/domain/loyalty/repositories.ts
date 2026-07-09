import type { ActivityEvent } from "./activity";
import type { BalanceSnapshot } from "./balance-snapshot";
import type { LoyaltyAccount } from "./loyalty-account";
import type { PortfolioShare } from "./portfolio-share";
import type { TripGoal } from "./trip-goal";

/**
 * Persistence ports (repository interfaces). The application layer depends on
 * these abstractions; the infrastructure layer supplies the Drizzle-backed
 * implementations (dependency inversion).
 */

/**
 * Snapshots needed to compute balance deltas for one account. `asOf30Days` /
 * `asOf90Days` are the newest readings on or before those cutoffs (null when
 * the account has no history that old).
 */
export interface BalanceTrendContext {
  readonly latest: BalanceSnapshot | null;
  readonly previous: BalanceSnapshot | null;
  readonly asOf30Days: BalanceSnapshot | null;
  readonly asOf90Days: BalanceSnapshot | null;
}

export interface LoyaltyAccountRepository {
  findById(id: string): Promise<LoyaltyAccount | null>;
  /** Active (non-deleted) accounts for a user, pinned first then createdAt. */
  findByUserId(userId: string): Promise<LoyaltyAccount[]>;
  /** Soft-deleted accounts still inside the restore window. */
  findDeletedByUserId(userId: string): Promise<LoyaltyAccount[]>;
  /** Distinct ids of users with at least one linked account (for batch jobs). */
  listUserIds(): Promise<string[]>;
  findByUserAndProvider(
    userId: string,
    providerId: string,
  ): Promise<LoyaltyAccount | null>;
  insert(account: LoyaltyAccount): Promise<void>;
  update(account: LoyaltyAccount): Promise<void>;
  /** Hard-deletes the account; snapshots cascade at the storage layer. */
  delete(id: string): Promise<void>;
}

export interface BalanceSnapshotRepository {
  insert(snapshot: BalanceSnapshot): Promise<void>;
  /** Latest snapshot per account, for the given account ids. */
  findLatestByAccountIds(
    accountIds: readonly string[],
  ): Promise<Map<string, BalanceSnapshot>>;
  /**
   * Latest, previous, and as-of-30/90-day snapshots per account - everything
   * needed for balance deltas, in one round trip.
   */
  findTrendContextByAccountIds(
    accountIds: readonly string[],
    now: Date,
  ): Promise<Map<string, BalanceTrendContext>>;
  /** Snapshot history for one account, newest first. */
  findByAccountId(
    accountId: string,
    limit: number,
  ): Promise<BalanceSnapshot[]>;
}

export interface ActivityEventRepository {
  insert(event: ActivityEvent): Promise<void>;
  /** Newest-first feed for a user. */
  findByUserId(userId: string, limit: number): Promise<ActivityEvent[]>;
}

export interface TripGoalRepository {
  findById(id: string): Promise<TripGoal | null>;
  findByUserId(userId: string): Promise<TripGoal[]>;
  insert(goal: TripGoal): Promise<void>;
  update(goal: TripGoal): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface PortfolioShareRepository {
  findById(id: string): Promise<PortfolioShare | null>;
  findByToken(token: string): Promise<PortfolioShare | null>;
  findByUserId(userId: string): Promise<PortfolioShare[]>;
  insert(share: PortfolioShare): Promise<void>;
  update(share: PortfolioShare): Promise<void>;
  delete(id: string): Promise<void>;
}
