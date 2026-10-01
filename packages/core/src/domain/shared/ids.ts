import { InvalidIdError } from "../errors";
import type { Brand } from "./brand";

/**
 * Branded identifiers. Each kind is a type plus a same-named value with pure
 * constructors, so call sites read `UserId.parse(raw)`:
 *
 * - `parse(raw)` is the edge constructor (route handlers, server actions,
 *   MCP/worker/bot entry points, DB row mappers). It rejects only a value
 *   that cannot be an id at all (not a non-empty string) with the coded
 *   `InvalidIdError`; it never checks existence or ownership, which stay
 *   use-case concerns, so behaviour for any real id is unchanged.
 * - `is(value)` is the same check as a type guard.
 * - `generate()` mints a fresh UUID for kinds the system itself creates.
 *
 * DTOs, wire payloads and DB columns stay plain `string`; brands exist only
 * in the type system.
 */

interface IdKind<B extends string> {
  readonly kind: B;
  parse(raw: string): Brand<string, B>;
  is(value: unknown): value is Brand<string, B>;
}

interface GeneratedIdKind<B extends string> extends IdKind<B> {
  generate(): Brand<string, B>;
}

function opaqueIdKind<B extends string>(kind: B): IdKind<B> {
  const is = (value: unknown): value is Brand<string, B> =>
    typeof value === "string" && value.length > 0;
  return {
    kind,
    is,
    parse(raw: string): Brand<string, B> {
      if (!is(raw)) throw new InvalidIdError(kind);
      return raw;
    },
  };
}

function uuidIdKind<B extends string>(kind: B): GeneratedIdKind<B> {
  return {
    ...opaqueIdKind(kind),
    generate: () => crypto.randomUUID() as Brand<string, B>,
  };
}

/** Identity-provider user id (Clerk id, or the fixed dev user). Opaque. */
export type UserId = Brand<string, "UserId">;
export const UserId: IdKind<"UserId"> = opaqueIdKind("UserId");

export type LoyaltyAccountId = Brand<string, "LoyaltyAccountId">;
export const LoyaltyAccountId: GeneratedIdKind<"LoyaltyAccountId"> =
  uuidIdKind("LoyaltyAccountId");

export type TripGoalId = Brand<string, "TripGoalId">;
export const TripGoalId: GeneratedIdKind<"TripGoalId"> = uuidIdKind("TripGoalId");

export type ShareId = Brand<string, "ShareId">;
export const ShareId: GeneratedIdKind<"ShareId"> = uuidIdKind("ShareId");

export type AwardWatchId = Brand<string, "AwardWatchId">;
export const AwardWatchId: GeneratedIdKind<"AwardWatchId"> =
  uuidIdKind("AwardWatchId");

export type AccessTokenId = Brand<string, "AccessTokenId">;
export const AccessTokenId: GeneratedIdKind<"AccessTokenId"> =
  uuidIdKind("AccessTokenId");

export type ConsentId = Brand<string, "ConsentId">;
export const ConsentId: GeneratedIdKind<"ConsentId"> = uuidIdKind("ConsentId");

export type ObservationId = Brand<string, "ObservationId">;
export const ObservationId: GeneratedIdKind<"ObservationId"> =
  uuidIdKind("ObservationId");

export type TransferBonusId = Brand<string, "TransferBonusId">;
export const TransferBonusId: GeneratedIdKind<"TransferBonusId"> =
  uuidIdKind("TransferBonusId");

export type EventId = Brand<string, "EventId">;
export const EventId: GeneratedIdKind<"EventId"> = uuidIdKind("EventId");
