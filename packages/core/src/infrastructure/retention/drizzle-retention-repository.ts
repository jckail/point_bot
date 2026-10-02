import { sql } from "drizzle-orm";

import type { Database } from "../db/client";
import type { RetentionStore, RetentionTarget } from "./retention";

/**
 * Postgres purges. Every statement is `DELETE ... WHERE id IN (SELECT ... LIMIT
 * n FOR UPDATE SKIP LOCKED)`: the batch is bounded, rows another worker has
 * already locked are skipped (so concurrent purges never delete a row twice or
 * wait on each other), and each batch is its own short transaction.
 *
 * Only the four tables below are ever touched: `balance_snapshot` and
 * `agent_observation` are deliberately absent.
 */
export class DrizzleRetentionStore implements RetentionStore {
  constructor(private readonly db: Database) {}

  async purgeBatch(
    target: RetentionTarget,
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const at = sql`${cutoff.toISOString()}::timestamptz`;
    const n = Math.max(0, Math.floor(limit));
    if (n === 0) return 0;
    const rows = await this.db.execute(this.statement(target, at, n));
    return rows.length;
  }

  private statement(target: RetentionTarget, at: ReturnType<typeof sql>, n: number) {
    switch (target) {
      case "outbox":
        // Dead-lettered rows (processed_at stays null) are kept; the explicit
        // dead_lettered_at guard also protects a row both processed and parked.
        return sql`
          DELETE FROM domain_event_outbox
          WHERE id IN (
            SELECT id FROM domain_event_outbox
            WHERE processed_at IS NOT NULL
              AND dead_lettered_at IS NULL
              AND processed_at < ${at}
            ORDER BY processed_at
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
      case "activity":
        return sql`
          DELETE FROM activity_event
          WHERE id IN (
            SELECT id FROM activity_event
            WHERE occurred_at < ${at}
            ORDER BY occurred_at
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
      case "access_tokens":
        return sql`
          DELETE FROM access_token
          WHERE id IN (
            SELECT id FROM access_token
            WHERE (revoked_at IS NOT NULL AND revoked_at < ${at})
               OR (expires_at IS NOT NULL AND expires_at < ${at})
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
      case "consents":
        return sql`
          DELETE FROM consent_grant
          WHERE id IN (
            SELECT id FROM consent_grant
            WHERE expires_at < ${at}
               OR (revoked_at IS NOT NULL AND revoked_at < ${at})
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
    }
  }
}
