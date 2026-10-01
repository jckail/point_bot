import {
  buildDrizzleRepositories,
  buildLoyaltyModule,
  createDb,
  DrizzleOutboxStore,
  selectFx,
  selectGateway,
  selectLlm,
  selectScraper,
  selectVault,
  type AccessTokenRepository,
  type LoyaltyAccountRepository,
  type LoyaltyModule,
  type OutboxStore,
} from "@pointup/core";

import type { WorkerEnv } from "./env";

export interface WorkerContainer {
  accounts: LoyaltyAccountRepository;
  accessTokens: AccessTokenRepository;
  outbox: OutboxStore;
  useCases: Pick<
    LoyaltyModule,
    | "syncAllLoyaltyAccounts"
    | "buildPortfolioDigest"
    | "checkAwardWatches"
    | "seedDemoPortfolio"
  >;
}

/** The worker's composition root: env -> adapters, then the shared module. */
export function createContainer(env: WorkerEnv): WorkerContainer {
  const db = createDb(env.DATABASE_URL);
  const repos = buildDrizzleRepositories(db);
  const loyalty = buildLoyaltyModule({
    repos,
    gateway: selectGateway(env),
    vault: selectVault(env),
    fx: selectFx({}),
    scraper: selectScraper(env),
    // The worker never chats; the offline assistant keeps wiring uniform.
    llm: selectLlm({}),
  });

  return {
    accounts: repos.loyaltyAccounts,
    accessTokens: repos.accessTokens,
    outbox: new DrizzleOutboxStore(db),
    useCases: {
      syncAllLoyaltyAccounts: loyalty.syncAllLoyaltyAccounts,
      buildPortfolioDigest: loyalty.buildPortfolioDigest,
      checkAwardWatches: loyalty.checkAwardWatches,
      seedDemoPortfolio: loyalty.seedDemoPortfolio,
    },
  };
}
