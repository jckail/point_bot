import { randomUUID } from "node:crypto";
import {
  createObservationHeldNotifier,
  EventHandlerRegistry,
  OutboxProcessor,
  type DeadLetterInfo,
  type Notifier,
  type OutboxProcessorOptions,
  type OutboxRunResult,
} from "@pointup/core";

import { reportFailure } from "../failures";

import type { WorkerContainer } from "../container";
import type { WorkerEnv } from "../env";

/** Processor tuning derived from the validated worker environment. */
export function outboxOptions(env: WorkerEnv): OutboxProcessorOptions {
  return {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  };
}

/**
 * The in-process handler registry. Every handler must be idempotent: the
 * outbox is at-least-once, so an event can be delivered more than once.
 */
export function buildEventHandlers(
  notifier: Notifier | null,
  write?: (line: string) => void,
): EventHandlerRegistry {
  const registry = new EventHandlerRegistry().on("*", {
    name: "log",
    async handle() {
      // No event identity or payload is copied into operational logs.
      try {
        (write ?? console.log)(JSON.stringify({
          level: "info", category: "domain_event", job: "outbox", eventRef: randomUUID(),
        }));
      } catch { /* Best-effort telemetry must not retry a delivered event. */ }
    },
  });
  if (notifier) {
    registry.on("observation.held", createObservationHeldNotifier(notifier));
  }
  return registry;
}

/** Default dead-letter hook; the observability layer can swap in a counter. */
function logDeadLetter(_info: DeadLetterInfo): void {
  reportFailure("outbox_dead_letter", "outbox");
}

/**
 * Scheduled job: claim a batch of pending domain events (or drain the queue
 * with `drain`), dispatch to handlers, record the outcome. Safe to run in
 * many workers at once (`FOR UPDATE SKIP LOCKED`).
 */
export async function processOutbox(
  container: Pick<WorkerContainer, "outbox">,
  notifier: Notifier | null,
  options: OutboxProcessorOptions = {},
  mode: { drain?: boolean } = {},
): Promise<OutboxRunResult> {
  const processor = new OutboxProcessor(
    container.outbox,
    buildEventHandlers(notifier),
    { onDeadLetter: logDeadLetter, ...options },
  );
  const result = mode.drain ? await processor.drain() : await processor.runOnce();
  if (result.claimed > 0 || result.deadLettered > 0) {
    console.info(
      `[outbox] claimed=${result.claimed} processed=${result.processed} retried=${result.retried} dead=${result.deadLettered}`,
    );
  }
  return result;
}
