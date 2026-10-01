import type { ActivityEvent } from "../src/domain/loyalty/activity";
import type { BalanceSnapshot } from "../src/domain/loyalty/balance-snapshot";
import type { LoyaltyAccount } from "../src/domain/loyalty/loyalty-account";
import type { PortfolioShare } from "../src/domain/loyalty/portfolio-share";
import type {
  CustomValuation,
  CustomValuationRepository,
} from "../src/domain/loyalty/custom-valuation";
import type {
  AwardWatch,
  AwardWatchRepository,
} from "../src/domain/loyalty/award-watch";
import type {
  UserSettings,
  UserSettingsRepository,
} from "../src/domain/loyalty/user-settings";
import type { TripGoal } from "../src/domain/loyalty/trip-goal";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  BalanceTrendContext,
  LoyaltyAccountRepository,
  PortfolioShareRepository,
  TripGoalRepository,
} from "../src/domain/loyalty/repositories";
import type {
  AccessToken,
  AccessTokenRepository,
} from "../src/domain/agent/access-token";
import type {
  ConsentGrant,
  ConsentGrantRepository,
} from "../src/domain/agent/consent";
import type {
  AgentObservation,
  AgentObservationRepository,
} from "../src/domain/agent/observation";
import type { DomainEvent } from "../src/domain/events";
import type { Eventing } from "../src/application/events/ports";
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

export class InMemoryAwardWatchRepository implements AwardWatchRepository {
  readonly rows = new Map<string, AwardWatch>();

  async findById(id: string): Promise<AwardWatch | null> {
    return this.rows.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<AwardWatch[]> {
    return [...this.rows.values()].filter((w) => w.userId === userId);
  }

  async findAll(): Promise<AwardWatch[]> {
    return [...this.rows.values()];
  }

  async insert(watch: AwardWatch): Promise<void> {
    this.rows.set(watch.id, watch);
  }

  async update(watch: AwardWatch): Promise<void> {
    this.rows.set(watch.id, watch);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

export class InMemoryUserSettingsRepository implements UserSettingsRepository {
  readonly rows = new Map<string, UserSettings>();

  async get(userId: string): Promise<UserSettings | null> {
    return this.rows.get(userId) ?? null;
  }

  async upsert(settings: UserSettings): Promise<void> {
    this.rows.set(settings.userId, settings);
  }
}

export class InMemoryTokens implements AccessTokenRepository {
  readonly rows = new Map<string, AccessToken>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByHash(hash: string) {
    return [...this.rows.values()].find((t) => t.tokenHash === hash) ?? null;
  }
  async findByUserId(userId: string) {
    return [...this.rows.values()].filter((t) => t.userId === userId);
  }
  async insert(token: AccessToken) {
    this.rows.set(token.id, token);
  }
  async update(token: AccessToken) {
    this.rows.set(token.id, token);
  }
}

export class InMemoryConsents implements ConsentGrantRepository {
  readonly rows = new Map<string, ConsentGrant>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByUserId(userId: string) {
    return [...this.rows.values()].filter((c) => c.userId === userId);
  }
  async insert(c: ConsentGrant) {
    this.rows.set(c.id, c);
  }
  async update(c: ConsentGrant) {
    this.rows.set(c.id, c);
  }
  async replaceActive(c: ConsentGrant, at: Date) {
    for (const row of this.rows.values()) {
      if (row.userId === c.userId && row.providerId === c.providerId && !row.revokedAt) {
        this.rows.set(row.id, { ...row, revokedAt: at });
      }
    }
    this.rows.set(c.id, c);
  }
}

export class InMemoryObservations implements AgentObservationRepository {
  readonly rows: AgentObservation[] = [];
  async insert(o: AgentObservation) {
    this.rows.push(o);
  }
  async findById(id: string) {
    return this.rows.find((o) => o.id === id) ?? null;
  }
  async findByUserId(userId: string) {
    return this.rows.filter((o) => o.userId === userId);
  }
  async transition(
    id: string,
    userId: string,
    from: AgentObservation["outcome"],
    to: AgentObservation["outcome"],
  ) {
    const index = this.rows.findIndex(
      (o) => o.id === id && o.userId === userId && o.outcome === from,
    );
    if (index < 0) return null;
    this.rows[index] = { ...this.rows[index]!, outcome: to };
    return this.rows[index]!;
  }
}


/**
 * Eventing fake: records published events. `run` snapshots the buffer and
 * discards events published inside a failed unit of work, mimicking rollback.
 */
export class RecordingEventing implements Eventing {
  readonly events: DomainEvent[] = [];
  readonly publisher = {
    publish: async (events: readonly DomainEvent[]) => {
      this.events.push(...events);
    },
  };
  readonly unitOfWork = {
    // Events roll back, but the in-memory repositories do not.
    atomic: false,
    run: async <T>(work: () => Promise<T>): Promise<T> => {
      const mark = this.events.length;
      try {
        return await work();
      } catch (error) {
        this.events.length = mark;
        throw error;
      }
    },
  };

  types(): string[] {
    return this.events.map((event) => event.type);
  }
}
