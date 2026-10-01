import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { DuplicateLoyaltyAccountError } from "../../domain/errors";
import type { LoyaltyAccount } from "../../domain/loyalty/loyalty-account";
import { parseProviderId } from "../../domain/loyalty/provider";
import type { BalanceSnapshot } from "../../domain/loyalty/balance-snapshot";
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
import type { Database } from "../db/client";
import {
  accountTags,
  activityEvents,
  balanceSnapshots,
  loyaltyAccounts,
  portfolioShares,
  tripGoalAccounts,
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

type LoyaltyAccountRow = typeof loyaltyAccounts.$inferSelect & {
  tags: { tag: string; position: number }[];
};

/** Eager-load tags in stored order. */
const withTags = { tags: { orderBy: accountTags.position } } as const;
type BalanceSnapshotRow = typeof balanceSnapshots.$inferSelect;

function toLoyaltyAccount(row: LoyaltyAccountRow): LoyaltyAccount {
  return {
    id: row.id,
    userId: row.userId,
    providerId: parseProviderId(row.providerId),
    membershipNumber: row.membershipNumber,
    credentialRef: row.credentialRef,
    expiresAt: row.expiresAt,
    notes: row.notes,
    tags: row.tags.map((t) => t.tag),
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

const DAY_MS = 24 * 60 * 60 * 1000;

interface LateralSnapshotRow extends Record<string, unknown> {
  kind: string;
  account_id: string;
  id: string;
  points: number | string;
  source: BalanceSnapshot["source"];
  /** ISO-8601 UTC with millisecond precision (see `snapshotColumns`). */
  captured_at: string;
}

/**
 * Selected columns for raw snapshot SQL. `captured_at` is rendered as an ISO
 * string server-side so parsing never depends on the driver's date parsers
 * (Drizzle swaps them for pass-through strings).
 */
const snapshotColumns = sql.raw(
  `b.id, b.points, b.source, to_char(b.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at`,
);

function fromLateralRow(row: LateralSnapshotRow): BalanceSnapshot {
  return {
    id: row.id,
    loyaltyAccountId: row.account_id,
    points: Number(row.points),
    source: row.source,
    capturedAt: new Date(row.captured_at),
  };
}

/** `ARRAY['a','b']::text[]` with every id bound as a parameter. */
function textArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/** A Drizzle handle or an open transaction on it. */
type Executor = Pick<Database, "insert" | "delete">;

async function replaceTags(
  db: Executor,
  accountId: string,
  tags: readonly string[],
): Promise<void> {
  await db.delete(accountTags).where(eq(accountTags.accountId, accountId));
  const unique = [...new Set(tags)];
  if (unique.length === 0) return;
  await db
    .insert(accountTags)
    .values(unique.map((tag, position) => ({ accountId, tag, position })));
}

export class DrizzleLoyaltyAccountRepository implements LoyaltyAccountRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<LoyaltyAccount | null> {
    const row = await this.db.query.loyaltyAccounts.findFirst({
      where: eq(loyaltyAccounts.id, id),
      with: withTags,
    });
    return row ? toLoyaltyAccount(row) : null;
  }

  async findByUserId(userId: string): Promise<LoyaltyAccount[]> {
    const rows = await this.db.query.loyaltyAccounts.findMany({
      where: and(
        eq(loyaltyAccounts.userId, userId),
        isNull(loyaltyAccounts.deletedAt),
      ),
      with: withTags,
      // Pinned first (NULLS LAST), then oldest linked.
      orderBy: (table, { asc: a }) => [
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
      with: withTags,
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
      with: withTags,
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
      await this.db.transaction(async (tx) => {
        await tx.insert(loyaltyAccounts).values({
          id: account.id,
          userId: account.userId,
          providerId: account.providerId,
          membershipNumber: account.membershipNumber,
          credentialRef: account.credentialRef,
          expiresAt: account.expiresAt,
          notes: account.notes,
          pinnedAt: account.pinnedAt,
          deletedAt: account.deletedAt,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        });
        await replaceTags(tx, account.id, account.tags);
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
    await this.db.transaction(async (tx) => {
      await tx
        .update(loyaltyAccounts)
        .set({
          membershipNumber: account.membershipNumber,
          credentialRef: account.credentialRef,
          expiresAt: account.expiresAt,
          notes: account.notes,
          pinnedAt: account.pinnedAt,
          deletedAt: account.deletedAt,
          updatedAt: account.updatedAt,
        })
        .where(eq(loyaltyAccounts.id, account.id));
      await replaceTags(tx, account.id, account.tags);
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(loyaltyAccounts).where(eq(loyaltyAccounts.id, id));
  }
}

export class DrizzleBalanceSnapshotRepository implements BalanceSnapshotRepository {
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

    // One index probe per account (newest row of
    // balance_snapshot_account_captured_idx) instead of DISTINCT ON over every
    // snapshot of every requested account: cost is O(accounts), not
    // O(snapshots). Ties on captured_at break on id, newest first.
    const rows = await this.db.execute<LateralSnapshotRow>(sql`
      select 'latest' as kind, a.id as account_id, s.*
      from unnest(${textArray(accountIds)}) as a(id)
      cross join lateral (
        select ${snapshotColumns} from balance_snapshot b
        where b.loyalty_account_id = a.id
        order by b.captured_at desc, b.id desc
        limit 1
      ) s
    `);
    return new Map(
      [...rows].map((row) => [row.account_id, fromLateralRow(row)]),
    );
  }

  async findTrendContextByAccountIds(
    accountIds: readonly string[],
    now: Date,
  ): Promise<Map<string, BalanceTrendContext>> {
    if (accountIds.length === 0) return new Map();

    // Fetch only the four rows each trend needs (latest, previous, newest at
    // or before 30 days ago, newest at or before 90 days ago) with index
    // probes per account, rather than the full history (50-200+ rows per
    // account) which was then reduced in JS. Result size is <= 4 rows per
    // account regardless of history length.
    const cutoff30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
    const cutoff90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
    const probe = (kind: string, where: ReturnType<typeof sql>, offset = 0) => sql`(
      select ${sql.raw(`'${kind}'`)} as kind, ${snapshotColumns} from balance_snapshot b
      where b.loyalty_account_id = a.id ${where}
      order by b.captured_at desc, b.id desc
      limit 1 offset ${sql.raw(String(offset))}
    )`;
    const rows = await this.db.execute<LateralSnapshotRow>(sql`
      select s.kind, a.id as account_id, s.id, s.points, s.source, s.captured_at
      from unnest(${textArray(accountIds)}) as a(id)
      cross join lateral (
        ${probe("latest", sql``)}
        union all ${probe("previous", sql``, 1)}
        union all ${probe("d30", sql`and b.captured_at <= ${cutoff30}::timestamptz`)}
        union all ${probe("d90", sql`and b.captured_at <= ${cutoff90}::timestamptz`)}
      ) s
    `);

    const slots = new Map<string, Record<string, BalanceSnapshot>>();
    for (const row of rows) {
      let slot = slots.get(row.account_id);
      if (!slot) slots.set(row.account_id, (slot = {}));
      slot[row.kind] = fromLateralRow(row);
    }
    const result = new Map<string, BalanceTrendContext>();
    for (const accountId of accountIds) {
      const slot = slots.get(accountId) ?? {};
      result.set(accountId, {
        latest: slot.latest ?? null,
        previous: slot.previous ?? null,
        asOf30Days: slot.d30 ?? null,
        asOf90Days: slot.d90 ?? null,
      });
    }
    return result;
  }

  async findByAccountId(
    accountId: string,
    limit: number,
  ): Promise<BalanceSnapshot[]> {
    const rows = await this.db.query.balanceSnapshots.findMany({
      where: eq(balanceSnapshots.loyaltyAccountId, accountId),
      orderBy: (table, { desc: d }) => [d(table.capturedAt)],
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

type TripGoalRow = typeof tripGoals.$inferSelect & {
  accounts: { accountId: string; position: number }[];
};

const withGoalAccounts = {
  accounts: { orderBy: tripGoalAccounts.position },
} as const;

async function replaceGoalAccounts(
  db: Executor,
  goalId: string,
  accountIds: readonly string[],
): Promise<void> {
  await db.delete(tripGoalAccounts).where(eq(tripGoalAccounts.goalId, goalId));
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return;
  await db
    .insert(tripGoalAccounts)
    .values(
      unique.map((accountId, position) => ({ goalId, accountId, position })),
    );
}

function toTripGoal(row: TripGoalRow): TripGoal {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    targetPoints: row.targetPoints,
    targetDate: row.targetDate,
    accountIds: row.accounts.map((a) => a.accountId),
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
      with: withGoalAccounts,
    });
    return row ? toTripGoal(row) : null;
  }

  async findByUserId(userId: string): Promise<TripGoal[]> {
    const rows = await this.db.query.tripGoals.findMany({
      where: eq(tripGoals.userId, userId),
      with: withGoalAccounts,
      orderBy: (table, { desc: d }) => [d(table.updatedAt)],
    });
    return rows.map(toTripGoal);
  }

  async insert(goal: TripGoal): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(tripGoals).values({
        id: goal.id,
        userId: goal.userId,
        title: goal.title,
        targetPoints: goal.targetPoints,
        targetDate: goal.targetDate,
        status: goal.status,
        notes: goal.notes,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
      });
      await replaceGoalAccounts(tx, goal.id, goal.accountIds);
    });
  }

  async update(goal: TripGoal): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(tripGoals)
        .set({
          title: goal.title,
          targetPoints: goal.targetPoints,
          targetDate: goal.targetDate,
          status: goal.status,
          notes: goal.notes,
          updatedAt: goal.updatedAt,
        })
        .where(eq(tripGoals.id, goal.id));
      await replaceGoalAccounts(tx, goal.id, goal.accountIds);
    });
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

export class DrizzlePortfolioShareRepository implements PortfolioShareRepository {
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
