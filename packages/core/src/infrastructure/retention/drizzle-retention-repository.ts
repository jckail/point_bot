import { sql } from "drizzle-orm";

import type { Database } from "../db/client";
import type { RetentionStore, RetentionTarget } from "./retention";

/**
 * Postgres purges. A MATERIALIZED CTE claims at most n row IDs once using
 * FOR UPDATE SKIP LOCKED; DELETE USING consumes only that fixed batch. The
 * planner cannot rescan the locking selector and exceed the batch limit.
 * Already-locked rows are skipped, so concurrent purges do not claim the same
 * rows or wait on their row locks. Each batch is its own short transaction.
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
          WITH selected AS MATERIALIZED (
            SELECT id FROM domain_event_outbox
            WHERE processed_at IS NOT NULL
              AND dead_lettered_at IS NULL
              AND processed_at < ${at}
            ORDER BY processed_at
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM domain_event_outbox
          USING selected
          WHERE domain_event_outbox.id = selected.id
          RETURNING domain_event_outbox.id`;
      case "activity":
        return sql`
          WITH selected AS MATERIALIZED (
            SELECT id FROM activity_event
            WHERE occurred_at < ${at}
            ORDER BY occurred_at
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM activity_event
          USING selected
          WHERE activity_event.id = selected.id
          RETURNING activity_event.id`;
      case "access_tokens":
        return sql`
          WITH selected AS MATERIALIZED (
            SELECT id FROM access_token
            WHERE (revoked_at IS NOT NULL AND revoked_at < ${at})
               OR (expires_at IS NOT NULL AND expires_at < ${at})
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM access_token
          USING selected
          WHERE access_token.id = selected.id
          RETURNING access_token.id`;
      case "consents":
        return sql`
          WITH selected AS MATERIALIZED (
            SELECT id FROM consent_grant
            WHERE expires_at < ${at}
               OR (revoked_at IS NOT NULL AND revoked_at < ${at})
            LIMIT ${n}
            FOR UPDATE SKIP LOCKED
          )
          DELETE FROM consent_grant
          USING selected
          WHERE consent_grant.id = selected.id
          RETURNING consent_grant.id`;
    }
  }
}
