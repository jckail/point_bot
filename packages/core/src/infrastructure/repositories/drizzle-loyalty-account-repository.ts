import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { DuplicateLoyaltyAccountError } from "../../domain/errors";
import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import type {
  BalanceSnapshot,
} from "../../domain/loyalty/balance-snapshot";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  BalanceTrendContext,
  LoyaltyAccountRepository,
  PortfolioShareRepository,
  TripGoalRepository,
} from "../../domain/loyalty/repositories";
import type { ActivityEvent } from "../../domain/loyalty/activity";
import type { PortfolioShare } from "../../domain/loyalty/portfolio-share";
import { buildTrendContext } from "../../application/loyalty/balance-trend";
import type { Database } from "../db/client";
import {
  activityEvents,
  balanceSnapshots,
  loyaltyAccounts,
  portfolioShares,
  tripGoals,
} from "../db/schema";
import type { TripGoal } from "../../domain/loyalty/trip-goal";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // postgres-js raises PostgresError with a `code`; Drizzle wraps it in
  // DrizzleQueryError with the original on `cause`.
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === PG_UNIQUE_VIOLATION) return true;
  return isUniqueViolation(candidate.cause);
}

type LoyaltyAccountRow = typeof loyaltyAccounts.$inferSelect;
type BalanceSnapshotRow = typeof balanceSnapshots.$inferSelect;

function serializeTags(tags: readonly string[]): string {
  return tags.join(",");
}

function parseTags(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function toLoyaltyAccount(row: LoyaltyAccountRow): LoyaltyAccount {
  return {
    id: row.id,
    userId: row.userId,
    providerId: row.providerId,
    membershipNumber: row.membershipNumber,
    credentialRef: row.credentialRef,
    expiresAt: row.expiresAt,
    notes: row.notes,
    tags: parseTags(row.tags),
    pinnedAt: row.pinnedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBalanceSnapshot(row: BalanceSnapshotRow): BalanceSnapshot {
  return {
    id: row.id,
    loyaltyAccountId: row.loyaltyAccountId,
    points: row.points,
    source: row.source,
    capturedAt: row.capturedAt,
  };
}

export class DrizzleLoyaltyAccountRepository
  implements LoyaltyAccountRepository
{
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<LoyaltyAccount | null> {
    const row = await this.db.query.loyaltyAccounts.findFirst({
      where: eq(loyaltyAccounts.id, id),
    });
    return row ? toLoyaltyAccount(row) : null;
  }

  async findByUserId(userId: string): Promise<LoyaltyAccount[]> {
    const rows = await this.db.query.loyaltyAccounts.findMany({
      where: and(
        eq(loyaltyAccounts.userId, userId),
        isNull(loyaltyAccounts.deletedAt),
      ),
      // Pinned first (NULLS LAST), then oldest linked.
      orderBy: (table, { asc: a, desc: d }) => [
        sql`${table.pinnedAt} DESC NULLS LAST`,
        a(table.createdAt),
      ],
    });
    return rows.map(toLoyaltyAccount);
  }

  async findDeletedByUserId(userId: string): Promise<LoyaltyAccount[]> {
    const rows = await this.db.query.loyaltyAccounts.findMany({
      where: and(
        eq(loyaltyAccounts.userId, userId),
        isNotNull(loyaltyAccounts.deletedAt),
      ),
      orderBy: (table, { desc: d }) => [d(table.deletedAt)],
    });
    return rows.map(toLoyaltyAccount);
  }

  async findByUserAndProvider(
    userId: string,
    providerId: string,
  ): Promise<LoyaltyAccount | null> {
    // Include soft-deleted rows so re-linking the same provider is blocked
    // until restore or hard purge — the unique index still applies.
    const row = await this.db.query.loyaltyAccounts.findFirst({
      where: and(
        eq(loyaltyAccounts.userId, userId),
        eq(loyaltyAccounts.providerId, providerId),
      ),
    });
    return row ? toLoyaltyAccount(row) : null;
  }

  async listUserIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ userId: loyaltyAccounts.userId })
      .from(loyaltyAccounts)
      .where(isNull(loyaltyAccounts.deletedAt));
    return rows.map((row) => row.userId);
  }

  async insert(account: LoyaltyAccount): Promise<void> {
    try {
      await this.db.insert(loyaltyAccounts).values({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        membershipNumber: account.membershipNumber,
        credentialRef: account.credentialRef,
        expiresAt: account.expiresAt,
        notes: account.notes,
        tags: serializeTags(account.tags),
        pinnedAt: account.pinnedAt,
        deletedAt: account.deletedAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      });
    } catch (error) {
      // Two concurrent link requests can both pass the use case's duplicate
      // check; the unique index is the arbiter and we translate its verdict
      // back into the domain's language.
      if (isUniqueViolation(error)) {
        throw new DuplicateLoyaltyAccountError(account.providerId);
      }
      throw error;
    }
  }

  async update(account: LoyaltyAccount): Promise<void> {
    await this.db
      .update(loyaltyAccounts)
      .set({
        membershipNumber: account.membershipNumber,
        credentialRef: account.credentialRef,
        expiresAt: account.expiresAt,
        notes: account.notes,
        tags: serializeTags(account.tags),
        pinnedAt: account.pinnedAt,
        deletedAt: account.deletedAt,
        updatedAt: account.updatedAt,
      })
      .where(eq(loyaltyAccounts.id, account.id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(loyaltyAccounts).where(eq(loyaltyAccounts.id, id));
  }
}

export class DrizzleBalanceSnapshotRepository
  implements BalanceSnapshotRepository
{
  constructor(private readonly db: Database) {}

  async insert(snapshot: BalanceSnapshot): Promise<void> {
    await this.db.insert(balanceSnapshots).values({
      id: snapshot.id,
      loyaltyAccountId: snapshot.loyaltyAccountId,
      points: snapshot.points,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
    });
  }

  async findLatestByAccountIds(
    accountIds: readonly string[],
  ): Promise<Map<string, BalanceSnapshot>> {
    if (accountIds.length === 0) return new Map();

    // DISTINCT ON picks one row per account server-side (newest first via the
    // order by), instead of shipping every snapshot to the app and reducing
    // in JS. Served by the (loyalty_account_id, captured_at) index.
    const rows = await this.db
      .selectDistinctOn([balanceSnapshots.loyaltyAccountId])
      .from(balanceSnapshots)
      .where(inArray(balanceSnapshots.loyaltyAccountId, [...accountIds]))
      .orderBy(
        balanceSnapshots.loyaltyAccountId,
        desc(balanceSnapshots.capturedAt),
        // Tie-break equal timestamps deterministically.
        sql`${balanceSnapshots.id} DESC`,
      );

    return new Map(
      rows.map((row) => [row.loyaltyAccountId, toBalanceSnapshot(row)]),
    );
  }

  async findTrendContextByAccountIds(
    accountIds: readonly string[],
    now: Date,
  ): Promise<Map<string, BalanceTrendContext>> {
    if (accountIds.length === 0) return new Map();

    // Load history for the requested accounts (newest first) and reduce in
    // the application layer. Typical portfolios are small; the
    // (loyalty_account_id, captured_at) index keeps this cheap.
    const rows = await this.db.query.balanceSnapshots.findMany({
      where: inArray(balanceSnapshots.loyaltyAccountId, [...accountIds]),
      orderBy: (table, { desc: d }) => [d(table.capturedAt)],
    });

    const byAccount = new Map<string, BalanceSnapshot[]>();
    for (const id of accountIds) byAccount.set(id, []);
    for (const row of rows) {
      byAccount.get(row.loyaltyAccountId)?.push(toBalanceSnapshot(row));
    }

    const result = new Map<string, BalanceTrendContext>();
    for (const [accountId, snapshots] of byAccount) {
      result.set(accountId, buildTrendContext(snapshots, now));
    }
    return result;
  }

  async findByAccountId(
    accountId: string,
    limit: number,
  ): Promise<BalanceSnapshot[]> {
    const rows = await this.db.query.balanceSnapshots.findMany({
      where: eq(balanceSnapshots.loyaltyAccountId, accountId),
      orderBy: (table, { desc }) => [desc(table.capturedAt)],
      limit,
    });
    return rows.map(toBalanceSnapshot);
  }
}

export class DrizzleActivityEventRepository implements ActivityEventRepository {
  constructor(private readonly db: Database) {}

  async insert(event: ActivityEvent): Promise<void> {
    await this.db.insert(activityEvents).values({
      id: event.id,
      userId: event.userId,
      type: event.type,
      accountId: event.accountId,
      providerId: event.providerId,
      summary: event.summary,
      occurredAt: event.occurredAt,
    });
  }

  async findByUserId(userId: string, limit: number): Promise<ActivityEvent[]> {
    const rows = await this.db.query.activityEvents.findMany({
      where: eq(activityEvents.userId, userId),
      orderBy: (table, { desc: d }) => [d(table.occurredAt)],
      limit,
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type as ActivityEvent["type"],
      accountId: row.accountId,
      providerId: row.providerId,
      summary: row.summary,
      occurredAt: row.occurredAt,
    }));
  }
}

function serializeAccountIds(accountIds: readonly string[]): string {
  return accountIds.join(",");
}

function parseAccountIds(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

type TripGoalRow = typeof tripGoals.$inferSelect;

function toTripGoal(row: TripGoalRow): TripGoal {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    targetPoints: row.targetPoints,
    targetDate: row.targetDate,
    accountIds: parseAccountIds(row.accountIds),
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTripGoalRepository implements TripGoalRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<TripGoal | null> {
    const row = await this.db.query.tripGoals.findFirst({
      where: eq(tripGoals.id, id),
    });
    return row ? toTripGoal(row) : null;
  }

  async findByUserId(userId: string): Promise<TripGoal[]> {
    const rows = await this.db.query.tripGoals.findMany({
      where: eq(tripGoals.userId, userId),
      orderBy: (table, { desc: d }) => [d(table.updatedAt)],
    });
    return rows.map(toTripGoal);
  }

  async insert(goal: TripGoal): Promise<void> {
    await this.db.insert(tripGoals).values({
      id: goal.id,
      userId: goal.userId,
      title: goal.title,
      targetPoints: goal.targetPoints,
      targetDate: goal.targetDate,
      accountIds: serializeAccountIds(goal.accountIds),
      status: goal.status,
      notes: goal.notes,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });
  }

  async update(goal: TripGoal): Promise<void> {
    await this.db
      .update(tripGoals)
      .set({
        title: goal.title,
        targetPoints: goal.targetPoints,
        targetDate: goal.targetDate,
        accountIds: serializeAccountIds(goal.accountIds),
        status: goal.status,
        notes: goal.notes,
        updatedAt: goal.updatedAt,
      })
      .where(eq(tripGoals.id, goal.id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(tripGoals).where(eq(tripGoals.id, id));
  }
}

type PortfolioShareRow = typeof portfolioShares.$inferSelect;

function toPortfolioShare(row: PortfolioShareRow): PortfolioShare {
  return {
    id: row.id,
    userId: row.userId,
    token: row.token,
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export class DrizzlePortfolioShareRepository
  implements PortfolioShareRepository
{
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<PortfolioShare | null> {
    const row = await this.db.query.portfolioShares.findFirst({
      where: eq(portfolioShares.id, id),
    });
    return row ? toPortfolioShare(row) : null;
  }

  async findByToken(token: string): Promise<PortfolioShare | null> {
    const row = await this.db.query.portfolioShares.findFirst({
      where: eq(portfolioShares.token, token),
    });
    return row ? toPortfolioShare(row) : null;
  }

  async findByUserId(userId: string): Promise<PortfolioShare[]> {
    const rows = await this.db.query.portfolioShares.findMany({
      where: eq(portfolioShares.userId, userId),
      orderBy: (table, { desc: d }) => [d(table.createdAt)],
    });
    return rows.map(toPortfolioShare);
  }

  async insert(share: PortfolioShare): Promise<void> {
    await this.db.insert(portfolioShares).values({
      id: share.id,
      userId: share.userId,
      token: share.token,
      label: share.label,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
    });
  }

  async update(share: PortfolioShare): Promise<void> {
    await this.db
      .update(portfolioShares)
      .set({
        label: share.label,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
      })
      .where(eq(portfolioShares.id, share.id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(portfolioShares).where(eq(portfolioShares.id, id));
  }
}
