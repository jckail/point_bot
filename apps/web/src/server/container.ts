import {
  ChatWithAssistant,
  buildTravelProviderGateway,
  createDb,
  type Database,
  CreatePortfolioShare,
  CreateTripGoal,
  DeleteTripGoal,
  DrizzleActivityEventRepository,
  DrizzleBalanceSnapshotRepository,
  DrizzleLoyaltyAccountRepository,
  DrizzlePortfolioShareRepository,
  DrizzleTripGoalRepository,
  BedrockAssistant,
  BulkUpdateMembershipNumbers,
  BuildDisplayValue,
  CreateAwardWatch,
  DeleteAwardWatch,
  DrizzleAwardWatchRepository,
  ListAwardWatches,
  DeleteCustomValuation,
  DrizzleUserSettingsRepository,
  GetUserSettings,
  HttpFxRateSource,
  SetDisplayCurrency,
  StaticFxRateSource,
  DrizzleCustomValuationRepository,
  ListCustomValuations,
  SetCustomValuation,
  ExportPortfolio,
  FirecrawlPageScraper,
  GetBalanceHistory,
  GetLoyaltyAccount,
  GetPortfolioSummary,
  GetPublicPortfolioSnapshot,
  GetValueAdvice,
  HeuristicAssistant,
  ImportPortfolio,
  IngestDealPage,
  LinkLoyaltyAccount,
  ListActivity,
  ListDeletedLoyaltyAccounts,
  ListExpiringAccounts,
  ListLoyaltyAccounts,
  ListPortfolioShares,
  ListProviders,
  ListTripGoals,
  NullCredentialVault,
  OnePasswordConnectVault,
  OpenAiCompatibleAssistant,
  RecordManualBalance,
  RestoreLoyaltyAccount,
  RevokePortfolioShare,
  SeedDemoPortfolio,
  StubPageScraper,
  SyncAllLoyaltyAccounts,
  SyncLoyaltyAccount,
  UnlinkLoyaltyAccount,
  UpdateLoyaltyAccount,
  UpdateTripGoal,
  type CredentialVault,
  type LlmAssistant,
  type PageScraper,
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
  useCases: {
    listProviders: ListProviders;
    listLoyaltyAccounts: ListLoyaltyAccounts;
    getLoyaltyAccount: GetLoyaltyAccount;
    linkLoyaltyAccount: LinkLoyaltyAccount;
    updateLoyaltyAccount: UpdateLoyaltyAccount;
    bulkUpdateMembershipNumbers: BulkUpdateMembershipNumbers;
    unlinkLoyaltyAccount: UnlinkLoyaltyAccount;
    restoreLoyaltyAccount: RestoreLoyaltyAccount;
    listDeletedLoyaltyAccounts: ListDeletedLoyaltyAccounts;
    getBalanceHistory: GetBalanceHistory;
    recordManualBalance: RecordManualBalance;
    getPortfolioSummary: GetPortfolioSummary;
    exportPortfolio: ExportPortfolio;
    importPortfolio: ImportPortfolio;
    seedDemoPortfolio: SeedDemoPortfolio;
    listActivity: ListActivity;
    listExpiringAccounts: ListExpiringAccounts;
    listTripGoals: ListTripGoals;
    createTripGoal: CreateTripGoal;
    updateTripGoal: UpdateTripGoal;
    deleteTripGoal: DeleteTripGoal;
    createPortfolioShare: CreatePortfolioShare;
    listPortfolioShares: ListPortfolioShares;
    revokePortfolioShare: RevokePortfolioShare;
    getPublicPortfolioSnapshot: GetPublicPortfolioSnapshot;
    chatWithAssistant: ChatWithAssistant;
    getValueAdvice: GetValueAdvice;
    listCustomValuations: ListCustomValuations;
    createAwardWatch: CreateAwardWatch;
    listAwardWatches: ListAwardWatches;
    deleteAwardWatch: DeleteAwardWatch;
    getUserSettings: GetUserSettings;
    setDisplayCurrency: SetDisplayCurrency;
    buildDisplayValue: BuildDisplayValue;
    setCustomValuation: SetCustomValuation;
    deleteCustomValuation: DeleteCustomValuation;
    ingestDealPage: IngestDealPage;
    syncLoyaltyAccount: SyncLoyaltyAccount;
    syncAllLoyaltyAccounts: SyncAllLoyaltyAccounts;
  };
}

function buildVault(): CredentialVault {
  if (env.OP_CONNECT_HOST && env.OP_CONNECT_TOKEN) {
    return new OnePasswordConnectVault({
      baseUrl: env.OP_CONNECT_HOST,
      token: env.OP_CONNECT_TOKEN,
    });
  }
  return new NullCredentialVault();
}

function buildLlm(): LlmAssistant {
  // Production (AWS): Claude on Bedrock via the task role — no API keys.
  if (env.LLM_PROVIDER === "bedrock" && env.BEDROCK_MODEL_ID) {
    return new BedrockAssistant({
      modelId: env.BEDROCK_MODEL_ID,
      region: env.AWS_REGION,
    });
  }
  // Local/dev: any OpenAI-compatible endpoint if a key is present.
  if (env.LLM_API_KEY) {
    return new OpenAiCompatibleAssistant({
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      baseUrl: env.LLM_BASE_URL,
    });
  }
  // Fallback: deterministic heuristic assistant (offline demos, tests).
  return new HeuristicAssistant();
}

function buildScraper(): PageScraper {
  if (env.FIRECRAWL_API_KEY) {
    return new FirecrawlPageScraper({
      apiKey: env.FIRECRAWL_API_KEY,
      baseUrl: env.FIRECRAWL_BASE_URL,
    });
  }
  return new StubPageScraper();
}

function buildContainer(): Container {
  const db = createDb(env.DATABASE_URL);

  const loyaltyAccounts = new DrizzleLoyaltyAccountRepository(db);
  const balanceSnapshots = new DrizzleBalanceSnapshotRepository(db);
  const activity = new DrizzleActivityEventRepository(db);
  const tripGoals = new DrizzleTripGoalRepository(db);
  const shares = new DrizzlePortfolioShareRepository(db);
  const customValuations = new DrizzleCustomValuationRepository(db);
  const awardWatches = new DrizzleAwardWatchRepository(db);
  const settings = new DrizzleUserSettingsRepository(db);
  const fx = env.FX_API_URL
    ? new HttpFxRateSource({ baseUrl: env.FX_API_URL })
    : new StaticFxRateSource();
  const vault = buildVault();
  const gateway = buildTravelProviderGateway({
    aggregator:
      env.AGGREGATOR_API_URL && env.AGGREGATOR_API_KEY
        ? { baseUrl: env.AGGREGATOR_API_URL, apiKey: env.AGGREGATOR_API_KEY }
        : undefined,
  });

  const syncLoyaltyAccount = new SyncLoyaltyAccount(
    loyaltyAccounts,
    balanceSnapshots,
    gateway,
    vault,
    activity,
  );
  const listLoyaltyAccounts = new ListLoyaltyAccounts(
    loyaltyAccounts,
    balanceSnapshots,
    undefined,
    customValuations,
  );
  const linkLoyaltyAccount = new LinkLoyaltyAccount(loyaltyAccounts, activity);
  const recordManualBalance = new RecordManualBalance(
    loyaltyAccounts,
    balanceSnapshots,
    activity,
  );
  const updateLoyaltyAccount = new UpdateLoyaltyAccount(
    loyaltyAccounts,
    activity,
  );
  const createTripGoal = new CreateTripGoal(
    tripGoals,
    loyaltyAccounts,
    balanceSnapshots,
  );
  const listTripGoals = new ListTripGoals(tripGoals, balanceSnapshots);
  const llm = buildLlm();
  const scraper = buildScraper();

  return {
    db,
    useCases: {
      listProviders: new ListProviders(),
      listLoyaltyAccounts,
      getLoyaltyAccount: new GetLoyaltyAccount(
        loyaltyAccounts,
        balanceSnapshots,
        undefined,
        customValuations,
      ),
      linkLoyaltyAccount,
      updateLoyaltyAccount,
      bulkUpdateMembershipNumbers: new BulkUpdateMembershipNumbers(
        updateLoyaltyAccount,
      ),
      unlinkLoyaltyAccount: new UnlinkLoyaltyAccount(loyaltyAccounts, activity),
      restoreLoyaltyAccount: new RestoreLoyaltyAccount(
        loyaltyAccounts,
        balanceSnapshots,
        activity,
      ),
      listDeletedLoyaltyAccounts: new ListDeletedLoyaltyAccounts(
        loyaltyAccounts,
      ),
      getBalanceHistory: new GetBalanceHistory(
        loyaltyAccounts,
        balanceSnapshots,
      ),
      recordManualBalance,
      getPortfolioSummary: new GetPortfolioSummary(listLoyaltyAccounts),
      exportPortfolio: new ExportPortfolio(loyaltyAccounts, balanceSnapshots),
      importPortfolio: new ImportPortfolio(
        loyaltyAccounts,
        linkLoyaltyAccount,
        recordManualBalance,
      ),
      seedDemoPortfolio: new SeedDemoPortfolio(
        loyaltyAccounts,
        linkLoyaltyAccount,
        recordManualBalance,
        createTripGoal,
      ),
      listActivity: new ListActivity(activity),
      listExpiringAccounts: new ListExpiringAccounts(listLoyaltyAccounts),
      listTripGoals,
      createTripGoal,
      updateTripGoal: new UpdateTripGoal(
        tripGoals,
        loyaltyAccounts,
        balanceSnapshots,
      ),
      deleteTripGoal: new DeleteTripGoal(tripGoals),
      createPortfolioShare: new CreatePortfolioShare(shares),
      listPortfolioShares: new ListPortfolioShares(shares),
      revokePortfolioShare: new RevokePortfolioShare(shares),
      getPublicPortfolioSnapshot: new GetPublicPortfolioSnapshot(
        shares,
        listLoyaltyAccounts,
      ),
      chatWithAssistant: new ChatWithAssistant(
        listLoyaltyAccounts,
        listTripGoals,
        llm,
      ),
      getValueAdvice: new GetValueAdvice(listLoyaltyAccounts),
      listCustomValuations: new ListCustomValuations(customValuations),
      createAwardWatch: new CreateAwardWatch(awardWatches),
      listAwardWatches: new ListAwardWatches(awardWatches),
      deleteAwardWatch: new DeleteAwardWatch(awardWatches),
      getUserSettings: new GetUserSettings(settings),
      setDisplayCurrency: new SetDisplayCurrency(settings),
      buildDisplayValue: new BuildDisplayValue(settings, fx),
      setCustomValuation: new SetCustomValuation(customValuations),
      deleteCustomValuation: new DeleteCustomValuation(customValuations),
      ingestDealPage: new IngestDealPage(scraper),
      syncLoyaltyAccount,
      syncAllLoyaltyAccounts: new SyncAllLoyaltyAccounts(
        loyaltyAccounts,
        syncLoyaltyAccount,
      ),
    },
  };
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
