import {
  BuildPortfolioDigest,
  buildTravelProviderGateway,
  createDb,
  DrizzleBalanceSnapshotRepository,
  DrizzleLoyaltyAccountRepository,
  DrizzleTripGoalRepository,
  ListLoyaltyAccounts,
  ListTripGoals,
  NullCredentialVault,
  OnePasswordConnectVault,
  SyncAllLoyaltyAccounts,
  SyncLoyaltyAccount,
  type CredentialVault,
  type LoyaltyAccountRepository,
} from "@pointup/core";

import type { WorkerEnv } from "./env";

export interface WorkerContainer {
  accounts: LoyaltyAccountRepository;
  useCases: {
    syncAllLoyaltyAccounts: SyncAllLoyaltyAccounts;
    buildPortfolioDigest: BuildPortfolioDigest;
  };
}

/** The worker's composition root - mirrors the web app's container. */
export function createContainer(env: WorkerEnv): WorkerContainer {
  const db = createDb(env.DATABASE_URL);
  const accounts = new DrizzleLoyaltyAccountRepository(db);
  const balances = new DrizzleBalanceSnapshotRepository(db);
  const tripGoals = new DrizzleTripGoalRepository(db);

  const vault: CredentialVault =
    env.OP_CONNECT_HOST && env.OP_CONNECT_TOKEN
      ? new OnePasswordConnectVault({
          baseUrl: env.OP_CONNECT_HOST,
          token: env.OP_CONNECT_TOKEN,
        })
      : new NullCredentialVault();

  const gateway = buildTravelProviderGateway({
    aggregator:
      env.AGGREGATOR_API_URL && env.AGGREGATOR_API_KEY
        ? { baseUrl: env.AGGREGATOR_API_URL, apiKey: env.AGGREGATOR_API_KEY }
        : undefined,
  });

  const syncOne = new SyncLoyaltyAccount(
    accounts,
    balances,
    gateway,
    vault,
  );

  const listAccounts = new ListLoyaltyAccounts(accounts, balances);

  return {
    accounts,
    useCases: {
      syncAllLoyaltyAccounts: new SyncAllLoyaltyAccounts(accounts, syncOne),
      buildPortfolioDigest: new BuildPortfolioDigest(
        listAccounts,
        new ListTripGoals(tripGoals, balances),
      ),
    },
  };
}
