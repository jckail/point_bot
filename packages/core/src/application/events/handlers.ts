import type { DomainEvent } from "../../domain/events";
import { assertNever } from "../../domain/shared/enum";
import { findProvider } from "../../domain/loyalty/provider";
import type { Notifier } from "../ports";
import type { EventHandler } from "./outbox-processor";

/**
 * Structured-log handler: one JSON line per event. Logs ids and the event
 * type only; the payload is deliberately omitted so nothing sensitive can
 * leak through logs.
 */
export function createLogHandler(
  write: (line: string) => void = (line) => console.log(line),
): EventHandler {
  return {
    name: "log",
    async handle(event) {
      write(
        JSON.stringify({
          level: "info",
          msg: "domain_event",
          eventId: event.id,
          type: event.type,
          version: event.version,
          userId: event.userId,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt.toISOString(),
          ...(event.correlationId ? { correlationId: event.correlationId } : {}),
        }),
      );
    },
  };
}

/**
 * Chat fan-out for held agent readings: tells the team channel a reading is
 * waiting for human review. Not deduplicated (the Notifier port has no
 * idempotency key), so a retry after a partial failure can notify twice.
 */
export function createObservationHeldNotifier(notifier: Notifier): EventHandler {
  return {
    name: "notify-observation-held",
    async handle(event: DomainEvent) {
      if (event.type !== "observation.held") return;
      const { providerId, points, previousPoints } = event.payload;
      const provider = findProvider(providerId);
      const name = provider?.displayName ?? providerId;
      const was =
        previousPoints === null ? "" : ` (latest saved: ${previousPoints.toLocaleString("en-US")})`;
      const text = `An agent reading for ${name} (${points.toLocaleString("en-US")}${was}) was held for review. Open Dashboard > Agents to confirm or reject it.`;
      await notifier.notify({ text });
    },
  };
}

/** Exhaustive human-readable label per event type (compile-time checked). */
export function describeEvent(event: DomainEvent): string {
  switch (event.type) {
    case "account.linked":
      return "Account linked";
    case "account.updated":
      return "Account updated";
    case "account.unlinked":
      return "Account unlinked";
    case "account.restored":
      return "Account restored";
    case "balance.recorded":
      return `Balance recorded (${event.payload.source})`;
    case "consent.granted":
      return "Consent granted";
    case "consent.revoked":
      return "Consent revoked";
    case "observation.held":
      return "Observation held for review";
    case "observation.confirmed":
      return "Observation confirmed";
    case "observation.rejected":
      return "Observation rejected";
    case "token.issued":
      return "Access token issued";
    case "token.revoked":
      return "Access token revoked";
    case "goal.created":
      return "Goal created";
    case "goal.updated":
      return "Goal updated";
    case "goal.deleted":
      return "Goal deleted";
    case "watch.triggered":
      return "Award watch triggered";
    case "transfer_bonus.recorded":
      return "Transfer bonus recorded";
    default:
      return assertNever(event);
  }
}
