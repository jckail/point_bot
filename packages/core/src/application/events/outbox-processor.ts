import { randomUUID } from "node:crypto";

import type { DomainEvent, EventType } from "../../domain/events";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { ClaimedEvent, OutboxStore } from "./outbox";

/** Result of delivering one claimed event. */
export const DISPATCH_OUTCOMES = ["processed", "retried", "dead", "stale"] as const;
export type DispatchOutcome = (typeof DISPATCH_OUTCOMES)[number];

/**
 * A handler reacts to one delivered event. Delivery is at-least-once, so
 * handlers MUST be idempotent (dedupe on `event.id` or make the effect
 * naturally repeatable).
 */
export interface EventHandler {
  /** Stable internal handler name; never persisted as diagnostic text. */
  readonly name: string;
  handle(event: DomainEvent): Promise<void>;
}

/** In-process handler registry keyed by event type (`"*"` matches all). */
export class EventHandlerRegistry {
  private readonly byType = new Map<EventType | "*", EventHandler[]>();

  on(type: EventType | "*", handler: EventHandler): this {
    const list = this.byType.get(type) ?? [];
    list.push(handler);
    this.byType.set(type, list);
    return this;
  }

  handlersFor(type: EventType): readonly EventHandler[] {
    return [...(this.byType.get("*") ?? []), ...(this.byType.get(type) ?? [])];
  }
}

export interface DeadLetterInfo {
  readonly event: DomainEvent;
  readonly attempts: number;
  readonly error: string;
}

export interface OutboxProcessorOptions {
  readonly batchSize?: number;
  /** Attempts before an event is dead-lettered. */
  readonly maxAttempts?: number;
  readonly leaseMs?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly clock?: Clock;
  /** Metric hook: called once per event that was dead-lettered. */
  readonly onDeadLetter?: (info: DeadLetterInfo) => void;
  /** Metric hook: called after every batch. */
  readonly onBatch?: (result: OutboxRunResult) => void;
}

export interface OutboxRunResult {
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
}

export const DEFAULT_OUTBOX_BATCH_SIZE = 25;
export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 8;
export const DEFAULT_OUTBOX_LEASE_MS = 60_000;

/** Exponential backoff after `attempts` failed attempts: base * 2^(n-1), capped. */
export function outboxBackoffMs(
  attempts: number,
  baseMs = 5_000,
  maxMs = 3_600_000,
): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

/** Independent reference: thrown values are deliberately never inspected. */
function failureReference(): string {
  return `OUTBOX_DELIVERY_FAILED:${randomUUID()}`;
}

/**
 * Claims a batch from the outbox, dispatches each event to its registered
 * handlers, and records the outcome. Safe to run in many workers at once
 * because the store's `claim` hands each row to exactly one worker.
 */
export class OutboxProcessor {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly clock: Clock;

  constructor(
    private readonly store: OutboxStore,
    private readonly registry: EventHandlerRegistry,
    private readonly options: OutboxProcessorOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_OUTBOX_BATCH_SIZE;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_OUTBOX_LEASE_MS;
    this.clock = options.clock ?? systemClock;
  }

  /** Processes at most one batch. */
  async runOnce(): Promise<OutboxRunResult> {
    let deadLettered = await this.store.deadLetterExhausted(
      this.maxAttempts,
      this.clock.now(),
    );
    const claimed = await this.store.claim({
      limit: this.batchSize,
      now: this.clock.now(),
      leaseMs: this.leaseMs,
      maxAttempts: this.maxAttempts,
    });

    let processed = 0;
    let retried = 0;
    for (const item of claimed) {
      const outcome = await this.dispatch(item);
      if (outcome === "processed") processed += 1;
      else if (outcome === "retried") retried += 1;
      else if (outcome === "dead") deadLettered += 1;
    }

    const result = { claimed: claimed.length, processed, retried, deadLettered };
    this.options.onBatch?.(result);
    return result;
  }

  /** Drains the outbox (until a batch comes back empty or `maxBatches`). */
  async drain(maxBatches = 100): Promise<OutboxRunResult> {
    const total = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
    for (let i = 0; i < maxBatches; i += 1) {
      const result = await this.runOnce();
      total.claimed += result.claimed;
      total.processed += result.processed;
      total.retried += result.retried;
      total.deadLettered += result.deadLettered;
      if (result.claimed === 0) break;
    }
    return total;
  }

  private async dispatch(
    item: ClaimedEvent,
  ): Promise<DispatchOutcome> {
    const { event, attempts } = item;
    try {
      for (const handler of this.registry.handlersFor(event.type)) {
        await handler.handle(event);
      }
      return await this.store.markProcessed(event.id, this.clock.now(), item)
        ? "processed" : "stale";
    } catch {
      const message = failureReference();
      const now = this.clock.now();
      if (attempts >= this.maxAttempts) {
        if (!await this.store.deadLetter(event.id, now, message, item)) return "stale";
        this.options.onDeadLetter?.({ event, attempts, error: message });
        return "dead";
      }
      const delay = outboxBackoffMs(
        attempts,
        this.options.baseBackoffMs,
        this.options.maxBackoffMs,
      );
      const applied = await this.store.scheduleRetry(
        event.id,
        new Date(now.getTime() + delay),
        message,
        item,
      );
      return applied ? "retried" : "stale";
    }
  }
}
