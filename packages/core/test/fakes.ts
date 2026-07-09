import type { ActivityEvent } from "../src/domain/loyalty/activity";
import type { BalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import type { PortfolioShare } from "../src/domain/loyalty/portfolio-share";
import type {
  CustomValuation,
  CustomValuationRepository,
} from "../src/domain/loyalty/custom-valuation";
import type { TripGoal } from "../src/domain/loyalty/trip-goal";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  BalanceTrendContext,
  LoyaltyAccountRepository,
  PortfolioShareRepository,
  TripGoalRepository,
} from "../src/domain/loyalty/repositories";
import { buildTrendContext } from "../src/application/loyalty/balance-trend";
import type {
  CredentialVault,
  ProviderCredential,
} from "../src/application/ports";

/**
 * In-memory fakes. Because use cases depend only on ports, the whole
 * application layer is testable without a database or network.
 */

export class InMemoryLoyaltyAccountRepository
  implements LoyaltyAccountRepository
{
  readonly rows = new Map<string, LoyaltyAccount>();

  async findById(id: string): Promise<LoyaltyAccount | null> {
    return this.rows.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<LoyaltyAccount[]> {
    return [...this.rows.values()]
      .filter((account) => account.userId === userId && !account.deletedAt)
      .sort((a, b) => {
        if (a.pinnedAt && !b.pinnedAt) return -1;
        if (!a.pinnedAt && b.pinnedAt) return 1;
        if (a.pinnedAt && b.pinnedAt) {
          return b.pinnedAt.getTime() - a.pinnedAt.getTime();
        }
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  async findDeletedByUserId(userId: string): Promise<LoyaltyAccount[]> {
    return [...this.rows.values()]
      .filter((account) => account.userId === userId && account.deletedAt)
      .sort(
        (a, b) =>
          (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0),
      );
  }

  async findByUserAndProvider(
    userId: string,
    providerId: string,
  ): Promise<LoyaltyAccount | null> {
    return (
      [...this.rows.values()].find(
        (account) =>
          account.userId === userId && account.providerId === providerId,
      ) ?? null
    );
  }

  async listUserIds(): Promise<string[]> {
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((row) => !row.deletedAt)
          .map((row) => row.userId),
      ),
    ];
  }

  async insert(account: LoyaltyAccount): Promise<void> {
    this.rows.set(account.id, account);
  }

  async update(account: LoyaltyAccount): Promise<void> {
    this.rows.set(account.id, account);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class InMemoryBalanceSnapshotRepository
  implements BalanceSnapshotRepository
{
  readonly rows: BalanceSnapshot[] = [];

  async insert(snapshot: BalanceSnapshot): Promise<void> {
    this.rows.push(snapshot);
  }

  async findLatestByAccountIds(
    accountIds: readonly string[],
  ): Promise<Map<string, BalanceSnapshot>> {
    const latest = new Map<string, BalanceSnapshot>();
    for (const row of this.rows) {
      if (!accountIds.includes(row.loyaltyAccountId)) continue;
      const current = latest.get(row.loyaltyAccountId);
      if (!current || row.capturedAt > current.capturedAt) {
        latest.set(row.loyaltyAccountId, row);
      }
    }
    return latest;
  }

  async findTrendContextByAccountIds(
    accountIds: readonly string[],
    now: Date,
  ): Promise<Map<string, BalanceTrendContext>> {
    const result = new Map<string, BalanceTrendContext>();
    for (const accountId of accountIds) {
      const snapshots = this.rows
        .filter((row) => row.loyaltyAccountId === accountId)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
      result.set(accountId, buildTrendContext(snapshots, now));
    }
    return result;
  }

  async findByAccountId(
    accountId: string,
    limit: number,
  ): Promise<BalanceSnapshot[]> {
    return this.rows
      .filter((row) => row.loyaltyAccountId === accountId)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, limit);
  }
}

export class FakeCredentialVault implements CredentialVault {
  constructor(
    private readonly entries: Record<string, ProviderCredential> = {},
  ) {}

  async resolve(credentialRef: string): Promise<ProviderCredential | null> {
    return this.entries[credentialRef] ?? null;
  }
}

export class InMemoryActivityEventRepository
  implements ActivityEventRepository
{
  readonly rows: ActivityEvent[] = [];

  async insert(event: ActivityEvent): Promise<void> {
    this.rows.push(event);
  }

  async findByUserId(userId: string, limit: number): Promise<ActivityEvent[]> {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}

export class InMemoryTripGoalRepository implements TripGoalRepository {
  readonly rows = new Map<string, TripGoal>();

  async findById(id: string): Promise<TripGoal | null> {
    return this.rows.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<TripGoal[]> {
    return [...this.rows.values()].filter((goal) => goal.userId === userId);
  }

  async insert(goal: TripGoal): Promise<void> {
    this.rows.set(goal.id, goal);
  }

  async update(goal: TripGoal): Promise<void> {
    this.rows.set(goal.id, goal);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class InMemoryPortfolioShareRepository
  implements PortfolioShareRepository
{
  readonly rows = new Map<string, PortfolioShare>();

  async findById(id: string): Promise<PortfolioShare | null> {
    return this.rows.get(id) ?? null;
  }

  async findByToken(token: string): Promise<PortfolioShare | null> {
    return (
      [...this.rows.values()].find((share) => share.token === token) ?? null
    );
  }

  async findByUserId(userId: string): Promise<PortfolioShare[]> {
    return [...this.rows.values()].filter((share) => share.userId === userId);
  }

  async insert(share: PortfolioShare): Promise<void> {
    this.rows.set(share.id, share);
  }

  async update(share: PortfolioShare): Promise<void> {
    this.rows.set(share.id, share);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class InMemoryCustomValuationRepository
  implements CustomValuationRepository
{
  readonly rows = new Map<string, CustomValuation>();

  private key(userId: string, providerId: string): string {
    return `${userId}::${providerId}`;
  }

  async listForUser(userId: string) {
    return [...this.rows.values()].filter((v) => v.userId === userId);
  }

  async upsert(valuation: CustomValuation) {
    this.rows.set(this.key(valuation.userId, valuation.providerId), valuation);
  }

  async delete(userId: string, providerId: string) {
    this.rows.delete(this.key(userId, providerId));
  }
}
