import type { AccessTokenRepository } from "../domain/agent/access-token";
import type { ConsentGrantRepository } from "../domain/agent/consent";
import type { AgentObservationRepository } from "../domain/agent/observation";
import type { AwardWatchRepository } from "../domain/loyalty/award-watch";
import type { CustomValuationRepository } from "../domain/loyalty/custom-valuation";
import type {
  ActivityEventRepository,
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
  PortfolioShareRepository,
  TripGoalRepository,
} from "../domain/loyalty/repositories";
import type { UserSettingsRepository } from "../domain/loyalty/user-settings";
import type { Eventing } from "../application/events/ports";
import type { Database } from "../infrastructure/db/client";
import {
  DrizzleAccessTokenRepository,
  DrizzleAgentObservationRepository,
  DrizzleConsentGrantRepository,
} from "../infrastructure/repositories/drizzle-agent-repositories";
import { DrizzleAwardWatchRepository } from "../infrastructure/repositories/drizzle-award-watch-repository";
import { DrizzleCustomValuationRepository } from "../infrastructure/repositories/drizzle-custom-valuation-repository";
import {
  DrizzleActivityEventRepository,
  DrizzleBalanceSnapshotRepository,
  DrizzleLoyaltyAccountRepository,
  DrizzlePortfolioShareRepository,
  DrizzleTripGoalRepository,
} from "../infrastructure/repositories/drizzle-loyalty-account-repository";
import {
  DrizzleEventPublisher,
  DrizzleUnitOfWork,
} from "../infrastructure/outbox/drizzle-outbox";
import { DrizzleUserSettingsRepository } from "../infrastructure/repositories/drizzle-user-settings-repository";

/** Every persistence port the composition modules consume. */
export interface Repositories {
  loyaltyAccounts: LoyaltyAccountRepository;
  balanceSnapshots: BalanceSnapshotRepository;
  activity: ActivityEventRepository;
  tripGoals: TripGoalRepository;
  shares: PortfolioShareRepository;
  customValuations: CustomValuationRepository;
  awardWatches: AwardWatchRepository;
  settings: UserSettingsRepository;
  accessTokens: AccessTokenRepository;
  consents: ConsentGrantRepository;
  observations: AgentObservationRepository;
  /**
   * Atomic state + domain-event recording (transactional outbox). Optional:
   * omitted in unit tests, in which case use cases run without events.
   */
  eventing?: Eventing;
}

export interface DrizzleRepositoryOptions {
  /** Supplies the ambient correlation id stamped on recorded events. */
  correlationId?: () => string | undefined;
}

/**
 * Postgres-backed repositories sharing one Drizzle handle. Every repository
 * is built on the unit of work's proxied handle, so use cases that run inside
 * `eventing.unitOfWork.run` get state changes and outbox rows in one
 * transaction without any repository knowing about it.
 */
export function buildDrizzleRepositories(
  rootDb: Database,
  options: DrizzleRepositoryOptions = {},
): Repositories {
  const unitOfWork = new DrizzleUnitOfWork(rootDb);
  const db = unitOfWork.db;
  return {
    eventing: {
      unitOfWork,
      publisher: new DrizzleEventPublisher(db, options.correlationId),
    },
    loyaltyAccounts: new DrizzleLoyaltyAccountRepository(db),
    balanceSnapshots: new DrizzleBalanceSnapshotRepository(db),
    activity: new DrizzleActivityEventRepository(db),
    tripGoals: new DrizzleTripGoalRepository(db),
    shares: new DrizzlePortfolioShareRepository(db),
    customValuations: new DrizzleCustomValuationRepository(db),
    awardWatches: new DrizzleAwardWatchRepository(db),
    settings: new DrizzleUserSettingsRepository(db),
    accessTokens: new DrizzleAccessTokenRepository(db),
    consents: new DrizzleConsentGrantRepository(db),
    observations: new DrizzleAgentObservationRepository(db),
  };
}
