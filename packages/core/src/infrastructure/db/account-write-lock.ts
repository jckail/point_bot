import { and, eq, sql } from "drizzle-orm";
import type { LoyaltyAccountId } from "../../domain/shared/ids";
import type { Database } from "./client";
import { loyaltyAccounts } from "./schema";

/**
 * Shared ordering for manual/sync/agent writes and human review: provider
 * advisory lock, then account row lock. Call inside the caller's transaction.
 * The provider lock also serializes account auto-link and consent replacement.
 */
export async function lockAccountForWrite(db: Pick<Database, "select" | "execute">, id: LoyaltyAccountId) {
  const [initial] = await db.select().from(loyaltyAccounts).where(eq(loyaltyAccounts.id, id)).limit(1);
  if (!initial) return null;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`consent:${initial.userId}:${initial.providerId}`}, 0))`);
  const [locked] = await db.select().from(loyaltyAccounts).where(and(
    eq(loyaltyAccounts.id, id),
    eq(loyaltyAccounts.userId, initial.userId),
    eq(loyaltyAccounts.providerId, initial.providerId),
  )).for("update");
  return locked ?? null;
}
