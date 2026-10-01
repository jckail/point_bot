import { AsyncLocalStorage } from "node:async_hooks";

import { and, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import type {
  ClaimedEvent,
  ClaimOptions,
  OutboxStore,
} from "../../application/events/outbox";
import type {
  EventPublisher,
  UnitOfWork,
} from "../../application/events/ports";
import {
  isEventType,
  type DomainEvent,
} from "../../domain/events";
import { EventId, UserId } from "../../domain/shared/ids";
import type { Database } from "../db/client";
import { domainEventOutbox } from "../db/schema";

/**
 * Unit of work over one Drizzle handle, without rewriting repositories.
 *
 * `db` is a proxy to the root handle that transparently redirects every call
 * to the ambient transaction while a `run` callback is active (tracked with
 * AsyncLocalStorage). Repositories built from `unitOfWork.db` therefore join
 * the transaction automatically; outside `run` they behave exactly as before.
 * Nested `db.transaction(...)` calls inside `run` become savepoints.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  readonly atomic = true;
  readonly db: Database;
  private readonly storage = new AsyncLocalStorage<Database>();

  constructor(private readonly root: Database) {
    const storage = this.storage;
    this.db = new Proxy(root, {
      get(target, property) {
        const current = storage.getStore() ?? target;
        const value = Reflect.get(current, property, current) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(current)
          : value;
      },
    });
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) return work();
    return this.root.transaction((tx) =>
      this.storage.run(tx as unknown as Database, work),
    );
  }
}

/**
 * Writes events into `domain_event_outbox`. Pass the unit of work's proxied
 * `db`: inside `UnitOfWork.run` the insert joins the caller's transaction;
 * outside it is a standalone insert (then it is NOT atomic with state).
 */
export class DrizzleEventPublisher implements EventPublisher {
  constructor(
    private readonly db: Database,
    /** Supplies the ambient correlation id (e.g. request id), if any. */
    private readonly correlationId: () => string | undefined = () => undefined,
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const ambient = this.correlationId();
    await this.db.insert(domainEventOutbox).values(
      events.map((event) => ({
        id: event.id,
        type: event.type,
        version: event.version,
        userId: event.userId,
        aggregateId: event.aggregateId,
        payload: event.payload,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId ?? ambient ?? null,
        availableAt: event.occurredAt,
      })),
    );
  }
}

type OutboxRow = typeof domainEventOutbox.$inferSelect;

function toClaimed(row: OutboxRow): ClaimedEvent {
  if (!isEventType(row.type)) {
    throw new Error(`Unknown outbox event type "${row.type}" (row ${row.id})`);
  }
  const event = {
    id: EventId.parse(row.id),
    type: row.type,
    occurredAt: row.occurredAt,
    userId: UserId.parse(row.userId),
    aggregateId: row.aggregateId,
    version: row.version,
    payload: row.payload,
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
  } as DomainEvent;
  return { event, attempts: row.attempts };
}

const iso = (date: Date) => date.toISOString();

/**
 * Postgres outbox consumer. `claim` uses `FOR UPDATE SKIP LOCKED` inside one
 * short UPDATE: it bumps `attempts` and pushes `available_at` out by the
 * lease, so concurrent workers never receive the same row and a crashed
 * worker's rows reappear once the lease lapses. No transaction is held open
 * while handlers run.
 */
export class DrizzleOutboxStore implements OutboxStore {
  constructor(private readonly db: Database) {}

  async claim(options: ClaimOptions): Promise<ClaimedEvent[]> {
    const leaseUntil = new Date(options.now.getTime() + options.leaseMs);
    const candidates = this.db
      .select({ id: domainEventOutbox.id })
      .from(domainEventOutbox)
      .where(
        and(
          isNull(domainEventOutbox.processedAt),
          isNull(domainEventOutbox.deadLetteredAt),
          lte(domainEventOutbox.availableAt, options.now),
          lt(domainEventOutbox.attempts, options.maxAttempts),
        ),
      )
      .orderBy(
        domainEventOutbox.availableAt,
        domainEventOutbox.occurredAt,
        domainEventOutbox.id,
      )
      .limit(options.limit)
      .for("update", { skipLocked: true });
    const rows = await this.db
      .update(domainEventOutbox)
      .set({
        attempts: sql`${domainEventOutbox.attempts} + 1`,
        availableAt: leaseUntil,
      })
      .where(inArray(domainEventOutbox.id, candidates))
      .returning();
    // Oldest first; RETURNING order is unspecified.
    return rows
      .map(toClaimed)
      .sort(
        (a, b) =>
          a.event.occurredAt.getTime() - b.event.occurredAt.getTime() ||
          a.event.id.localeCompare(b.event.id),
      );
  }

  async markProcessed(id: EventId, now: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE domain_event_outbox
      SET processed_at = ${iso(now)}::timestamptz, last_error = NULL
      WHERE id = ${id} AND processed_at IS NULL
    `);
  }

  async scheduleRetry(id: EventId, retryAt: Date, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE domain_event_outbox
      SET available_at = ${iso(retryAt)}::timestamptz, last_error = ${error}
      WHERE id = ${id} AND processed_at IS NULL
    `);
  }

  async deadLetter(id: EventId, now: Date, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE domain_event_outbox
      SET dead_lettered_at = ${iso(now)}::timestamptz, last_error = ${error}
      WHERE id = ${id} AND processed_at IS NULL
    `);
  }

  async deadLetterExhausted(maxAttempts: number, now: Date): Promise<number> {
    const rows = await this.db.execute(sql`
      UPDATE domain_event_outbox
      SET dead_lettered_at = ${iso(now)}::timestamptz,
          last_error = COALESCE(last_error, 'attempts exhausted without outcome')
      WHERE processed_at IS NULL
        AND dead_lettered_at IS NULL
        AND attempts >= ${maxAttempts}
        AND available_at <= ${iso(now)}::timestamptz
      RETURNING id
    `);
    return rows.length;
  }

  /** Rows parked in the dead-letter state (for gauges / alerting). */
  async countDeadLettered(): Promise<number> {
    const rows = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM domain_event_outbox
      WHERE dead_lettered_at IS NOT NULL AND processed_at IS NULL
    `);
    return rows[0]?.n ?? 0;
  }
}

