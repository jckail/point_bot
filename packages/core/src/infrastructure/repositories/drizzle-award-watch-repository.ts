import { desc, eq } from "drizzle-orm";

import type {
  AwardWatch,
  AwardWatchRepository,
} from "../../domain/loyalty/award-watch";
import type { Database } from "../db/client";
import { awardWatches } from "../db/schema";

/** Cents-per-point values persist as integer milli-cents (× 1000). */
const MILLI = 1000;

type Row = typeof awardWatches.$inferSelect;

function toDomain(row: Row): AwardWatch {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    label: row.label,
    minCentsPerPoint: row.minCentsPerPointMilli / MILLI,
    bestSeenCentsPerPoint:
      row.bestSeenCentsPerPointMilli === null
        ? null
        : row.bestSeenCentsPerPointMilli / MILLI,
    lastCheckedAt: row.lastCheckedAt,
    lastNotifiedAt: row.lastNotifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(watch: AwardWatch): Row {
  return {
    id: watch.id,
    userId: watch.userId,
    url: watch.url,
    label: watch.label,
    minCentsPerPointMilli: Math.round(watch.minCentsPerPoint * MILLI),
    bestSeenCentsPerPointMilli:
      watch.bestSeenCentsPerPoint === null
        ? null
        : Math.round(watch.bestSeenCentsPerPoint * MILLI),
    lastCheckedAt: watch.lastCheckedAt,
    lastNotifiedAt: watch.lastNotifiedAt,
    createdAt: watch.createdAt,
    updatedAt: watch.updatedAt,
  };
}

export class DrizzleAwardWatchRepository implements AwardWatchRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<AwardWatch | null> {
    const rows = await this.db
      .select()
      .from(awardWatches)
      .where(eq(awardWatches.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<AwardWatch[]> {
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

  async delete(id: string): Promise<void> {
    await this.db.delete(awardWatches).where(eq(awardWatches.id, id));
  }
}
