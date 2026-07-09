import { and, eq } from "drizzle-orm";

import type {
  CustomValuation,
  CustomValuationRepository,
} from "../../domain/loyalty/custom-valuation";
import type { Database } from "../db/client";
import { userProviderValuations } from "../db/schema";

/** Cents-per-point is persisted as an integer number of milli-cents. */
const MILLI = 1000;

export class DrizzleCustomValuationRepository
  implements CustomValuationRepository
{
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<CustomValuation[]> {
    const rows = await this.db
      .select()
      .from(userProviderValuations)
      .where(eq(userProviderValuations.userId, userId));

    return rows.map((row) => ({
      userId: row.userId,
      providerId: row.providerId,
      centsPerPoint: row.centsPerPointMilli / MILLI,
      updatedAt: row.updatedAt,
    }));
  }

  async upsert(valuation: CustomValuation): Promise<void> {
    const row = {
      userId: valuation.userId,
      providerId: valuation.providerId,
      centsPerPointMilli: Math.round(valuation.centsPerPoint * MILLI),
      updatedAt: valuation.updatedAt,
    };
    await this.db
      .insert(userProviderValuations)
      .values(row)
      .onConflictDoUpdate({
        target: [
          userProviderValuations.userId,
          userProviderValuations.providerId,
        ],
        set: {
          centsPerPointMilli: row.centsPerPointMilli,
          updatedAt: row.updatedAt,
        },
      });
  }

  async delete(userId: string, providerId: string): Promise<void> {
    await this.db
      .delete(userProviderValuations)
      .where(
        and(
          eq(userProviderValuations.userId, userId),
          eq(userProviderValuations.providerId, providerId),
        ),
      );
  }
}
