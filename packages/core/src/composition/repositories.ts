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
}

/** Postgres-backed repositories sharing one Drizzle handle. */
export function buildDrizzleRepositories(db: Database): Repositories {
  return {
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
