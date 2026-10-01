import type { BalanceSource } from "../loyalty/balance-snapshot";
import type { TransferBonusSource } from "../loyalty/transfer-bonus";
import { isOneOf } from "../shared/enum";


import {
  EventId,
  type AccessTokenId,
  type AwardWatchId,
  type ConsentId,
  type LoyaltyAccountId,
  type ObservationId,
  type TransferBonusId,
  type TripGoalId,
  type UserId,
} from "../shared/ids";
/**
 * Typed domain events. An event records a fact that already happened inside
 * the system; consumers react to it asynchronously via the transactional
 * outbox (see docs/events.md).
 *
 * Payloads carry ids and non-sensitive facts only: never membership numbers,
 * credential refs, token plaintext/hashes, emails, URLs, or free-text titles.
 * Dates inside payloads are ISO-8601 strings so a payload survives a JSON
 * round trip unchanged.
 */

export const EVENT_TYPES = [
  "account.linked",
  "account.updated",
  "account.unlinked",
  "account.restored",
  "balance.recorded",
  "consent.granted",
  "consent.revoked",
  "observation.held",
  "observation.confirmed",
  "observation.rejected",
  "token.issued",
  "token.revoked",
  "goal.created",
  "goal.updated",
  "goal.deleted",
  "watch.triggered",
  "transfer_bonus.recorded",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return isOneOf(EVENT_TYPES, value);
}


/** Payload shape per event type. Adding a type here forces every switch to handle it. */
export interface EventPayloads {
  "account.linked": { providerId: string };
  /** `changed` lists field names only, never their values. */
  "account.updated": { providerId: string; changed: string[] };
  "account.unlinked": { providerId: string };
  "account.restored": { providerId: string };
  "balance.recorded": {
    accountId: LoyaltyAccountId;
    providerId: string;
    points: number;
    previousPoints: number | null;
    source: BalanceSource;
    capturedAt: string;
  };
  "consent.granted": { providerId: string; expiresAt: string };
  "consent.revoked": { providerId: string };
  "observation.held": {
    accountId: LoyaltyAccountId;
    providerId: string;
    points: number;
    previousPoints: number | null;
    reviewExpiresAt: string;
  };
  "observation.confirmed": {
    accountId: LoyaltyAccountId;
    providerId: string;
    points: number;
    previousPoints: number | null;
  };
  "observation.rejected": {
    accountId: LoyaltyAccountId;
    providerId: string;
    points: number;
    previousPoints: number | null;
  };
  "token.issued": { scopes: string[]; expiresAt: string | null };
  "token.revoked": Record<string, never>;
  "goal.created": { targetPoints: number };
  "goal.updated": { changed: string[] };
  "goal.deleted": Record<string, never>;
  "watch.triggered": { bestRealizedCpp: number; minCentsPerPoint: number };
  /** Source URL and creator are deliberately omitted from the payload. */
  "transfer_bonus.recorded": {
    fromProviderId: string;
    toProviderId: string;
    multiplierPermille: number;
    startsAt: string;
    endsAt: string;
    source: TransferBonusSource;
  };
}

/** Current schema version per type; bump when a payload changes shape. */
export const EVENT_SCHEMA_VERSIONS = {
  "account.linked": 1,
  "account.updated": 1,
  "account.unlinked": 1,
  "account.restored": 1,
  "balance.recorded": 1,
  "consent.granted": 1,
  "consent.revoked": 1,
  "observation.held": 1,
  "observation.confirmed": 1,
  "observation.rejected": 1,
  "token.issued": 1,
  "token.revoked": 1,
  "goal.created": 1,
  "goal.updated": 1,
  "goal.deleted": 1,
  "watch.triggered": 1,
  "transfer_bonus.recorded": 1,
} satisfies Readonly<Record<EventType, number>>;

/**
 * Id kind of the aggregate each event type is about. Keyed by `EventType`, so
 * a new event type must say which aggregate it belongs to, and a producer
 * cannot publish `consent.granted` with an account id as its `aggregateId`.
 * (The outbox column stays a plain string.)
 */
export interface EventAggregateIds {
  "account.linked": LoyaltyAccountId;
  "account.updated": LoyaltyAccountId;
  "account.unlinked": LoyaltyAccountId;
  "account.restored": LoyaltyAccountId;
  "balance.recorded": LoyaltyAccountId;
  "consent.granted": ConsentId;
  "consent.revoked": ConsentId;
  "observation.held": ObservationId;
  "observation.confirmed": ObservationId;
  "observation.rejected": ObservationId;
  "token.issued": AccessTokenId;
  "token.revoked": AccessTokenId;
  "goal.created": TripGoalId;
  "goal.updated": TripGoalId;
  "goal.deleted": TripGoalId;
  "watch.triggered": AwardWatchId;
  "transfer_bonus.recorded": TransferBonusId;
}

export interface DomainEventEnvelope<T extends EventType> {
  readonly id: EventId;
  readonly type: T;
  readonly occurredAt: Date;
  readonly userId: UserId;
  /** Id of the entity the event is about (account, consent, token, ...). */
  readonly aggregateId: EventAggregateIds[T];
  /** Payload schema version. */
  readonly version: number;
  readonly payload: EventPayloads[T];
  readonly correlationId?: string;
}

export type DomainEventOf<T extends EventType> = DomainEventEnvelope<T>;

/** Discriminated union over `type`. */
export type DomainEvent = { [T in EventType]: DomainEventEnvelope<T> }[EventType];

export interface NewEventInput<T extends EventType> {
  readonly userId: UserId;
  readonly aggregateId: EventAggregateIds[T];
  readonly occurredAt: Date;
  readonly payload: EventPayloads[T];
  readonly correlationId?: string;
  readonly id?: EventId;
}

export function createDomainEvent<T extends EventType>(
  type: T,
  input: NewEventInput<T>,
): DomainEventEnvelope<T> {
  return {
    id: input.id ?? EventId.generate(),
    type,
    occurredAt: input.occurredAt,
    userId: input.userId,
    aggregateId: input.aggregateId,
    version: EVENT_SCHEMA_VERSIONS[type],
    payload: input.payload,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

/** Narrowing helper: `isEventOfType(event, "balance.recorded")`. */
export function isEventOfType<T extends EventType>(
  event: DomainEvent,
  type: T,
): event is Extract<DomainEvent, { type: T }> {
  return event.type === type;
}
