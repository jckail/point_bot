import {
  buildAgentModule,
  buildDrizzleRepositories,
  buildLoyaltyModule,
  createDb,
  selectFx,
  selectGateway,
  selectLlm,
  selectScraper,
  selectVault,
  type AgentModule,
  type Database,
  type LoyaltyModule,
} from "@pointup/core";

import { env } from "@/env";

/**
 * Composition root for the web surface. This is the only place that knows
 * concrete implementations; everything else depends on ports (dependency
 * inversion). Other hosts (workers, CLIs, future surfaces' backends) build
 * their own containers from the same core.
 */
export interface Container {
  db: Database;
  useCases: LoyaltyModule & AgentModule;
}

function buildContainer(): Container {
  const db = createDb(env.DATABASE_URL);
  const repos = buildDrizzleRepositories(db);
  const loyalty = buildLoyaltyModule({
    repos,
    gateway: selectGateway(env),
    vault: selectVault(env),
    fx: selectFx(env),
    scraper: selectScraper(env),
    llm: selectLlm(env),
  });
  const agent = buildAgentModule({
    repos,
    recordManualBalance: loyalty.recordManualBalance,
    linkLoyaltyAccount: loyalty.linkLoyaltyAccount,
  });

  return { db, useCases: { ...loyalty, ...agent } };
}

/** Cached across HMR reloads in development. */
const globalForContainer = globalThis as unknown as {
  container: Container | undefined;
};

export function getContainer(): Container {
  if (!globalForContainer.container) {
    globalForContainer.container = buildContainer();
  }
  return globalForContainer.container;
}
