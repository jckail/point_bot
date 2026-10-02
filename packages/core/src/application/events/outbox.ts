import type { DomainEvent } from "../../domain/events";
import type { EventId } from "../../domain/shared/ids";

/** Persisted claim generation; an older worker cannot finalize a newer claim. */
export interface OutboxClaim {
  /** Delivery attempts including the current one (incremented at claim). */
  readonly attempts: number;
  /** Exact available_at written by claim, also fences manual attempt resets. */
  readonly leaseUntil: Date;
}

/** A claimed outbox row: the event plus delivery bookkeeping. */
export interface ClaimedEvent extends OutboxClaim {
  readonly event: DomainEvent;
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
 * two workers never receive the same row within its current lease. A slow
 * handler can outlive that lease; every outcome must match its claim generation.
 */
export interface OutboxStore {
  claim(options: ClaimOptions): Promise<ClaimedEvent[]>;
  /** True only when this claim finalized the row; terminal/stale claims return false. */
  markProcessed(id: EventId, now: Date, claim: OutboxClaim): Promise<boolean>;
  /** Releases this claim for retry; false leaves a newer or terminal row untouched. */
  scheduleRetry(id: EventId, retryAt: Date, error: string, claim: OutboxClaim): Promise<boolean>;
  /** Parks this claim for good; false leaves a newer or terminal row untouched. */
  deadLetter(id: EventId, now: Date, error: string, claim: OutboxClaim): Promise<boolean>;
  /**
   * Parks rows that exhausted their attempts without a recorded outcome
   * (e.g. the worker crashed on the final attempt). Returns how many.
   */
  deadLetterExhausted(maxAttempts: number, now: Date): Promise<number>;
}
