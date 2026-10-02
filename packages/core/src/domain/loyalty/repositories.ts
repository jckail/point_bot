import type { ActivityEvent } from "./activity";
import type { BalanceSnapshot } from "./balance-snapshot";
import type { LoyaltyAccount } from "./loyalty-account";
import type { PortfolioShare } from "./portfolio-share";
import type { TripGoal } from "./trip-goal";

import type { LoyaltyAccountId, ShareId, TripGoalId, UserId } from "../shared/ids";
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
  findById(id: LoyaltyAccountId): Promise<LoyaltyAccount | null>;
  /** Provider/account serialization; call inside an atomic UOW. */
  lockById?(id: LoyaltyAccountId): Promise<LoyaltyAccount | null>;
  /** Active (non-deleted) accounts for a user, pinned first then createdAt. */
  findByUserId(userId: UserId): Promise<LoyaltyAccount[]>;
  /** Soft-deleted accounts still inside the restore window. */
  findDeletedByUserId(userId: UserId): Promise<LoyaltyAccount[]>;
  /** Distinct ids of users with at least one linked account (for batch jobs). */
  listUserIds(): Promise<UserId[]>;
  findByUserAndProvider(
    userId: UserId,
    providerId: string,
  ): Promise<LoyaltyAccount | null>;
  insert(account: LoyaltyAccount): Promise<void>;
  update(account: LoyaltyAccount): Promise<void>;
  /** Hard-deletes the account; snapshots cascade at the storage layer. */
  delete(id: LoyaltyAccountId): Promise<void>;
}

export interface BalanceSnapshotRepository {
  insert(snapshot: BalanceSnapshot): Promise<void>;
  /** Latest snapshot per account, for the given account ids. */
  findLatestByAccountIds(
    accountIds: readonly LoyaltyAccountId[],
  ): Promise<Map<LoyaltyAccountId, BalanceSnapshot>>;
  /**
   * Latest, previous, and as-of-30/90-day snapshots per account - everything
   * needed for balance deltas, in one round trip.
   */
  findTrendContextByAccountIds(
    accountIds: readonly LoyaltyAccountId[],
    now: Date,
  ): Promise<Map<LoyaltyAccountId, BalanceTrendContext>>;
  /** Snapshot history for one account, newest first. */
  findByAccountId(
    accountId: LoyaltyAccountId,
    limit: number,
  ): Promise<BalanceSnapshot[]>;
}

export interface ActivityEventRepository {
  insert(event: ActivityEvent): Promise<void>;
  /** Newest-first feed for a user. */
  findByUserId(userId: UserId, limit: number): Promise<ActivityEvent[]>;
}

export interface TripGoalRepository {
  findById(id: TripGoalId): Promise<TripGoal | null>;
  findByUserId(userId: UserId): Promise<TripGoal[]>;
  insert(goal: TripGoal): Promise<void>;
  update(goal: TripGoal): Promise<void>;
  delete(id: TripGoalId): Promise<void>;
}

export interface PortfolioShareRepository {
  findById(id: ShareId): Promise<PortfolioShare | null>;
  findByToken(token: string): Promise<PortfolioShare | null>;
  findByUserId(userId: UserId): Promise<PortfolioShare[]>;
  insert(share: PortfolioShare): Promise<void>;
  update(share: PortfolioShare): Promise<void>;
  delete(id: ShareId): Promise<void>;
}
