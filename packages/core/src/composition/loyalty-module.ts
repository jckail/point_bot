import {
  ChatWithAssistant,
  GetValueAdvice,
} from "../application/loyalty/assistant";
import { ManageAssistantActions, type ActionAudit } from "../application/assistant/manage-actions";
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
import {
  ListBestRedemptions,
  PlanRedemption,
} from "../application/loyalty/plan-redemption";
import {
  ListActiveTransferBonuses,
  RecordTransferBonus,
} from "../application/loyalty/transfer-bonuses";
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
  AwardAvailabilitySource,
  CredentialVault,
  Clock,
  LlmAssistant,
  PageScraper,
  TravelProviderGateway,
} from "../application/ports";
import type { Cache } from "../application/cache";
import type { FxRateSource } from "../domain/fx";
import { StubAwardAvailabilitySource } from "../infrastructure/award-search/award-availability-sources";
import type { Repositories } from "./repositories";

/** External ports the loyalty context needs beyond persistence. */
export interface LoyaltyModuleDeps {
  repos: Repositories;
  gateway: TravelProviderGateway;
  vault: CredentialVault;
  fx: FxRateSource;
  scraper: PageScraper;
  llm: LlmAssistant;
  /** Shared evaluation clock for balance reads, bonuses and transfer advice. */
  clock?: Clock;
  /** Best-effort proposal state observations; host chooses the telemetry sink. */
  assistantActionAudit?: ActionAudit;
  /** Optional: defaults to a stub that reports "not configured". */
  awardAvailability?: AwardAvailabilitySource;
  /**
   * Optional read-through cache for the accounts read model (which summary,
   * expiring, digest and advice all derive from). The host must invalidate
   * `userCacheTag(userId)` after writes; see apps/web/src/server/read-cache.ts.
   */
  cache?: Cache;
  /** Staleness bound for cross-process writes when `cache` is set (ms). */
  cacheTtlMs?: number;
}

/**
 * Composes every loyalty-context use case from ports. Pure wiring: no
 * environment access, no concrete adapters, so each host (web, bot, worker,
 * tests) supplies its own adapters and shares this graph.
 */
export function buildLoyaltyModule(deps: LoyaltyModuleDeps) {
  const { repos, gateway, vault, fx, scraper, llm, cache, cacheTtlMs, clock } = deps;
  const awardAvailability =
    deps.awardAvailability ?? new StubAwardAvailabilitySource();
  const eventing = repos.eventing;
  const {
    loyaltyAccounts,
    balanceSnapshots,
    activity,
    tripGoals,
    shares,
    customValuations,
    awardWatches,
    transferBonuses,
    settings,
  } = repos;

  const syncLoyaltyAccount = new SyncLoyaltyAccount(
    loyaltyAccounts,
    balanceSnapshots,
    gateway,
    vault,
    activity,
    undefined,
    eventing,
  );
  const listLoyaltyAccounts = new ListLoyaltyAccounts(
    loyaltyAccounts,
    balanceSnapshots,
    clock,
    customValuations,
    cache,
    cacheTtlMs,
  );
  const linkLoyaltyAccount = new LinkLoyaltyAccount(
    loyaltyAccounts,
    activity,
    undefined,
    eventing,
  );
  const recordManualBalance = new RecordManualBalance(
    loyaltyAccounts,
    balanceSnapshots,
    activity,
    undefined,
    eventing,
  );
  const updateLoyaltyAccount = new UpdateLoyaltyAccount(
    loyaltyAccounts,
    activity,
    undefined,
    eventing,
  );
  const createTripGoal = new CreateTripGoal(
    tripGoals,
    loyaltyAccounts,
    balanceSnapshots,
    undefined,
    eventing,
  );
  const listTripGoals = new ListTripGoals(tripGoals, balanceSnapshots);
  const ingestDealPage = new IngestDealPage(scraper);
  const listActiveTransferBonuses = new ListActiveTransferBonuses(transferBonuses, clock);
  const planRedemption = new PlanRedemption(
    listLoyaltyAccounts,
    listActiveTransferBonuses,
    awardAvailability,
    clock,
  );
  const getLoyaltyAccount = new GetLoyaltyAccount(loyaltyAccounts, balanceSnapshots, undefined, customValuations);
  const manageAssistantActions = repos.assistantActions
    ? new ManageAssistantActions(repos.assistantActions, { getLoyaltyAccount, recordManualBalance, createTripGoal }, undefined, deps.assistantActionAudit, eventing?.unitOfWork)
    : undefined;

  return {
    listProviders: new ListProviders(),
    listLoyaltyAccounts,
    getLoyaltyAccount,
    manageAssistantActions,
    linkLoyaltyAccount,
    updateLoyaltyAccount,
    bulkUpdateMembershipNumbers: new BulkUpdateMembershipNumbers(
      updateLoyaltyAccount,
    ),
    unlinkLoyaltyAccount: new UnlinkLoyaltyAccount(
      loyaltyAccounts,
      activity,
      undefined,
      eventing,
    ),
    restoreLoyaltyAccount: new RestoreLoyaltyAccount(
      loyaltyAccounts,
      balanceSnapshots,
      activity,
      undefined,
      eventing,
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
      undefined,
      eventing,
    ),
    deleteTripGoal: new DeleteTripGoal(tripGoals, undefined, eventing),
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
      listActiveTransferBonuses,
      clock,
    ),
    getValueAdvice: new GetValueAdvice(
      listLoyaltyAccounts,
      listActiveTransferBonuses,
      clock,
    ),
    listActiveTransferBonuses,
    recordTransferBonus: new RecordTransferBonus(
      transferBonuses,
      undefined,
      eventing,
    ),
    planRedemption,
    listBestRedemptions: new ListBestRedemptions(planRedemption),
    listCustomValuations: new ListCustomValuations(customValuations),
    createAwardWatch: new CreateAwardWatch(awardWatches),
    listAwardWatches: new ListAwardWatches(awardWatches),
    deleteAwardWatch: new DeleteAwardWatch(awardWatches),
    checkAwardWatches: new CheckAwardWatches(
      awardWatches,
      ingestDealPage,
      undefined,
      eventing,
    ),
    getUserSettings: new GetUserSettings(settings),
    setDisplayCurrency: new SetDisplayCurrency(settings),
    buildDisplayValue: new BuildDisplayValue(settings, fx, cache, cacheTtlMs),
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
