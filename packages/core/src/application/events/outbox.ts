import type { DomainEvent } from "../../domain/events";
import type { EventId } from "../../domain/shared/ids";

/** A claimed outbox row: the event plus delivery bookkeeping. */
export interface ClaimedEvent {
  readonly event: DomainEvent;
  /** Delivery attempts including the current one (incremented at claim). */
  readonly attempts: number;
}

export interface ClaimOptions {
  readonly limit: number;
  readonly now: Date;
  /**
   * Visibility timeout: a claimed row is hidden from other workers for this
   * long. If the worker dies mid-batch the row becomes claimable again.
   */
  readonly leaseMs: number;
  /** Rows that already used this many attempts are not claimed. */
  readonly maxAttempts: number;
}

/**
 * Consumer side of the transactional outbox. Implementations must make
 * `claim` safe under concurrency (Postgres: `FOR UPDATE SKIP LOCKED`), so
 * two workers never hold the same row at once.
 */
export interface OutboxStore {
  claim(options: ClaimOptions): Promise<ClaimedEvent[]>;
  /** Idempotent; a row that is already processed stays processed. */
  markProcessed(id: EventId, now: Date): Promise<void>;
  /** Releases the row for a later retry. */
  scheduleRetry(id: EventId, retryAt: Date, error: string): Promise<void>;
  /** Parks the row for good (kept for inspection, never claimed again). */
  deadLetter(id: EventId, now: Date, error: string): Promise<void>;
  /**
   * Parks rows that exhausted their attempts without a recorded outcome
   * (e.g. the worker crashed on the final attempt). Returns how many.
   */
  deadLetterExhausted(maxAttempts: number, now: Date): Promise<number>;
}
