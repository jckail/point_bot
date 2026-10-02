import type { MigrationConfig } from "drizzle-orm/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";

/** One key shared by every PointUp migration host and integration fixture. */
export const MIGRATION_LOCK_KEY = 846795951;

export interface MigrationLockOptions {
  /** Maximum wait for another migration, defaults to two minutes. */
  readonly lockTimeoutMs?: number;
}

/**
 * Acquire the lock before Drizzle creates or reads its journal. The reserved
 * connection holds the session lock while the migrator uses the remaining pool.
 */
export async function migrateWithLock<TSchema extends Record<string, unknown>>(
  db: PostgresJsDatabase<TSchema> & { $client: Sql },
  config: MigrationConfig,
  options: MigrationLockOptions = {},
): Promise<void> {
  const client = db.$client;
  if (client.options.max < 2) {
    throw new Error("Locked migrations require a dedicated pool with at least two connections.");
  }
  const timeoutMs = options.lockTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("Migration lock timeout must be between 1 and 300000 milliseconds.");
  }

  const lease = await client.reserve();
  let locked = false;
  let previousTimeout: string | undefined;
  try {
    const previous = await lease`SHOW lock_timeout`;
    previousTimeout = String(previous[0]?.lock_timeout ?? "0");
    await lease`SELECT set_config('lock_timeout', ${timeoutMs + "ms"}, false)`;
    await lease`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;
    await migrate(db, config);
  } finally {
    try {
      if (locked) await lease`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      if (previousTimeout !== undefined) {
        await lease`SELECT set_config('lock_timeout', ${previousTimeout}, false)`;
      }
    } catch (cleanupError) {
      // A session lock must never return to the pool after failed cleanup.
      // Hosts give this helper a dedicated migration client, so closing it
      // cannot interrupt application traffic and releases any surviving lock.
      await client.end({ timeout: 5 });
      throw cleanupError;
    } finally {
      lease.release();
    }
  }
}
