/**
 * Test-only constructors for branded ids and provider ids. Production code
 * must go through `UserId.parse(...)` etc. at the edge; tests build fixtures
 * with arbitrary literals (including ids that are not in the catalog, to
 * exercise negative paths), so they use unchecked casts here.
 */
import type {
  AccessTokenId,
  AwardWatchId,
  ConsentId,
  EventId,
  LoyaltyAccountId,
  ObservationId,
  ShareId,
  TransferBonusId,
  TripGoalId,
  UserId,
} from "../src/domain/shared/ids";
import type { ProviderId } from "../src/domain/loyalty/provider";

export const asUserId = (raw: string) => raw as UserId;
export const asAccountId = (raw: string) => raw as LoyaltyAccountId;
export const asTripGoalId = (raw: string) => raw as TripGoalId;
export const asShareId = (raw: string) => raw as ShareId;
export const asAwardWatchId = (raw: string) => raw as AwardWatchId;
export const asAccessTokenId = (raw: string) => raw as AccessTokenId;
export const asConsentId = (raw: string) => raw as ConsentId;
export const asObservationId = (raw: string) => raw as ObservationId;
export const asTransferBonusId = (raw: string) => raw as TransferBonusId;
export const asEventId = (raw: string) => raw as EventId;
export const asProviderId = (raw: string) => raw as ProviderId;
