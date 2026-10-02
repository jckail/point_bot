import { desc, eq } from "drizzle-orm";

import type {
  AwardWatch,
  AwardWatchRepository,
} from "../../domain/loyalty/award-watch";
import { AwardWatchId, UserId } from "../../domain/shared/ids";
import { InvalidAwardWatchError } from "../../domain/errors";
import { normalizeAwardWatchThreshold, normalizeObservedCentsPerPoint } from "../../domain/loyalty/award-watch";
import { safeIntegerFromDatabase } from "../db/numeric-values";
import type { Database } from "../db/client";
import { awardWatches } from "../db/schema";

/** Cents-per-point values persist as integer milli-cents (× 1000). */
const MILLI = 1000;

type Row = typeof awardWatches.$inferSelect;

function toDomain(row: Row): AwardWatch {
  return {
    id: AwardWatchId.parse(row.id),
    userId: UserId.parse(row.userId),
    url: row.url,
    label: row.label,
    minCentsPerPoint: safeIntegerFromDatabase(row.minCentsPerPointMilli, 1, 100_000, () => new InvalidAwardWatchError("Stored watch threshold requires repair")) / MILLI,
    bestSeenCentsPerPoint:
      row.bestSeenCentsPerPointMilli === null
        ? null
        : safeIntegerFromDatabase(row.bestSeenCentsPerPointMilli, 0, 2_147_483_647, () => new InvalidAwardWatchError("Stored observed rate requires repair")) / MILLI,
    lastCheckedAt: row.lastCheckedAt,
    lastNotifiedAt: row.lastNotifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(watch: AwardWatch): Row {
  const observed = normalizeObservedCentsPerPoint(watch.bestSeenCentsPerPoint);
  return {
    id: watch.id,
    userId: watch.userId,
    url: watch.url,
    label: watch.label,
    minCentsPerPointMilli: Math.round(normalizeAwardWatchThreshold(watch.minCentsPerPoint) * MILLI),
    bestSeenCentsPerPointMilli:
      observed === null
        ? null
        : Math.round(observed * MILLI),
    lastCheckedAt: watch.lastCheckedAt,
    lastNotifiedAt: watch.lastNotifiedAt,
    createdAt: watch.createdAt,
    updatedAt: watch.updatedAt,
  };
}

export class DrizzleAwardWatchRepository implements AwardWatchRepository {
  constructor(private readonly db: Database) {}

  async findById(id: AwardWatchId): Promise<AwardWatch | null> {
    const rows = await this.db
      .select()
      .from(awardWatches)
      .where(eq(awardWatches.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByUserId(userId: UserId): Promise<AwardWatch[]> {
    const rows = await this.db
      .select()
      .from(awardWatches)
      .where(eq(awardWatches.userId, userId))
      .orderBy(desc(awardWatches.createdAt));
    return rows.map(toDomain);
  }

  async findAll(): Promise<AwardWatch[]> {
    const rows = await this.db.select().from(awardWatches);
    return rows.map(toDomain);
  }

  async insert(watch: AwardWatch): Promise<void> {
    await this.db.insert(awardWatches).values(toRow(watch));
  }

  async update(watch: AwardWatch): Promise<void> {
    const { id, ...rest } = toRow(watch);
    await this.db
      .update(awardWatches)
      .set(rest)
      .where(eq(awardWatches.id, id));
  }

  async delete(id: AwardWatchId): Promise<void> {
    await this.db.delete(awardWatches).where(eq(awardWatches.id, id));
  }
}
