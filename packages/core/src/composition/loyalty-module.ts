import {
  ChatWithAssistant,
  GetValueAdvice,
} from "../application/loyalty/assistant";
import {
  CreateAwardWatch,
  ListAwardWatches,
  DeleteAwardWatch,
  CheckAwardWatches,
} from "../application/loyalty/award-watches";
import { BuildPortfolioDigest } from "../application/loyalty/build-portfolio-digest";
import { BulkUpdateMembershipNumbers } from "../application/loyalty/bulk-update-membership";
import { CreateTripGoal } from "../application/loyalty/create-trip-goal";
import {
  ListCustomValuations,
  SetCustomValuation,
  DeleteCustomValuation,
} from "../application/loyalty/custom-valuations";
import {
  GetUserSettings,
  SetDisplayCurrency,
  BuildDisplayValue,
} from "../application/loyalty/display-settings";
import { ExportPortfolio } from "../application/loyalty/export-portfolio";
import { GetBalanceHistory } from "../application/loyalty/get-balance-history";
import { GetLoyaltyAccount } from "../application/loyalty/get-loyalty-account";
import { GetPortfolioSummary } from "../application/loyalty/get-portfolio-summary";
import { ImportPortfolio } from "../application/loyalty/import-portfolio";
import { IngestDealPage } from "../application/loyalty/ingest-deal-page";
import { LinkLoyaltyAccount } from "../application/loyalty/link-loyalty-account";
import { ListActivity } from "../application/loyalty/list-activity";
import { ListExpiringAccounts } from "../application/loyalty/list-expiring-accounts";
import { ListLoyaltyAccounts } from "../application/loyalty/list-loyalty-accounts";
import { ListProviders } from "../application/loyalty/list-providers";
import { ListTripGoals } from "../application/loyalty/list-trip-goals";
import {
  CreatePortfolioShare,
  ListPortfolioShares,
  RevokePortfolioShare,
  GetPublicPortfolioSnapshot,
} from "../application/loyalty/portfolio-share";
import { RecordManualBalance } from "../application/loyalty/record-manual-balance";
import {
  RestoreLoyaltyAccount,
  ListDeletedLoyaltyAccounts,
} from "../application/loyalty/restore-loyalty-account";
import { SeedDemoPortfolio } from "../application/loyalty/seed-demo-portfolio";
import { SyncAllLoyaltyAccounts } from "../application/loyalty/sync-all-loyalty-accounts";
import { SyncLoyaltyAccount } from "../application/loyalty/sync-loyalty-account";
import {
  UpdateLoyaltyAccount,
  UnlinkLoyaltyAccount,
} from "../application/loyalty/update-loyalty-account";
import {
  UpdateTripGoal,
  DeleteTripGoal,
} from "../application/loyalty/update-trip-goal";
import type {
  CredentialVault,
  LlmAssistant,
  PageScraper,
  TravelProviderGateway,
} from "../application/ports";
import type { FxRateSource } from "../domain/fx";
import type { Repositories } from "./repositories";

/** External ports the loyalty context needs beyond persistence. */
export interface LoyaltyModuleDeps {
  repos: Repositories;
  gateway: TravelProviderGateway;
  vault: CredentialVault;
  fx: FxRateSource;
  scraper: PageScraper;
  llm: LlmAssistant;
}

/**
 * Composes every loyalty-context use case from ports. Pure wiring: no
 * environment access, no concrete adapters, so each host (web, bot, worker,
 * tests) supplies its own adapters and shares this graph.
 */
export function buildLoyaltyModule(deps: LoyaltyModuleDeps) {
  const { repos, gateway, vault, fx, scraper, llm } = deps;
  const {
    loyaltyAccounts,
    balanceSnapshots,
    activity,
    tripGoals,
    shares,
    customValuations,
    awardWatches,
    settings,
  } = repos;

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
  const ingestDealPage = new IngestDealPage(scraper);

  return {
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
    listDeletedLoyaltyAccounts: new ListDeletedLoyaltyAccounts(loyaltyAccounts),
    getBalanceHistory: new GetBalanceHistory(loyaltyAccounts, balanceSnapshots),
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
    checkAwardWatches: new CheckAwardWatches(awardWatches, ingestDealPage),
    getUserSettings: new GetUserSettings(settings),
    setDisplayCurrency: new SetDisplayCurrency(settings),
    buildDisplayValue: new BuildDisplayValue(settings, fx),
    setCustomValuation: new SetCustomValuation(customValuations),
    deleteCustomValuation: new DeleteCustomValuation(customValuations),
    ingestDealPage,
    syncLoyaltyAccount,
    syncAllLoyaltyAccounts: new SyncAllLoyaltyAccounts(
      loyaltyAccounts,
      syncLoyaltyAccount,
    ),
    buildPortfolioDigest: new BuildPortfolioDigest(
      listLoyaltyAccounts,
      listTripGoals,
    ),
  };
}

export type LoyaltyModule = ReturnType<typeof buildLoyaltyModule>;
