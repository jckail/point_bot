import { and, desc, eq, gte, lte } from "drizzle-orm";

import {
  isTransferBonusSource,
  type TransferBonus,
  type TransferBonusRepository,
} from "../../domain/loyalty/transfer-bonus";
import { TransferBonusId, UserId } from "../../domain/shared/ids";
import type { Database } from "../db/client";
import { transferBonuses } from "../db/schema";

type Row = typeof transferBonuses.$inferSelect;

function toDomain(row: Row): TransferBonus {
  return {
    id: TransferBonusId.parse(row.id),
    fromProviderId: row.fromProviderId,
    toProviderId: row.toProviderId,
    multiplierPermille: row.multiplierPermille,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    source: isTransferBonusSource(row.source) ? row.source : "user",
    sourceUrl: row.sourceUrl,
    verifiedAt: row.verifiedAt,
    createdBy: row.createdBy === null ? null : UserId.parse(row.createdBy),
    createdAt: row.createdAt,
  };
}

export class DrizzleTransferBonusRepository implements TransferBonusRepository {
  constructor(private readonly db: Database) {}

  async insert(bonus: TransferBonus): Promise<void> {
    await this.db.insert(transferBonuses).values({ ...bonus });
  }

  async findActive(at: Date): Promise<TransferBonus[]> {
    const rows = await this.db
      .select()
      .from(transferBonuses)
      .where(and(lte(transferBonuses.startsAt, at), gte(transferBonuses.endsAt, at)))
      .orderBy(desc(transferBonuses.createdAt), transferBonuses.id);
    return rows.map(toDomain);
  }

  async findById(id: TransferBonusId): Promise<TransferBonus | null> {
    const rows = await this.db
      .select()
      .from(transferBonuses)
      .where(eq(transferBonuses.id, id))
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }
}
