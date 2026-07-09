import { z } from "zod";

import type {
  PortfolioSummaryReadModel,
} from "../application/loyalty/get-portfolio-summary";
import type {
  BalanceReadModel,
  LoyaltyAccountReadModel,
  ProviderReadModel,
} from "../application/loyalty/read-models";
import type { SyncOutcome } from "../application/loyalty/sync-all-loyalty-accounts";
import { PROVIDER_KINDS } from "../domain/loyalty/provider";

/**
 * Wire contracts for the PointUp HTTP API (v1).
 *
 * This module is the single source of truth for what goes over the network.
 * It has no runtime dependency other than zod, so every surface - the web
 * app, mobile apps, browser extensions, and `@pointup/api-client` - can
 * import it without pulling in server-side code.
 *
 * Conventions:
 * - Request schemas are `.strict()`: unknown keys are rejected, so typos
 *   fail loudly instead of being silently ignored.
 * - Every timestamp on the wire is a strict ISO-8601 UTC string
 *   (`z.iso.datetime()`); `Date` objects never cross the network.
 */

/** Strict ISO-8601 UTC timestamp, e.g. "2026-07-08T14:03:00.000Z". */
export const isoDateTimeSchema = z.iso.datetime();

// ─── Schemas ───────────────────────────────────────────────────────────────

export const providerKindSchema = z.enum(PROVIDER_KINDS);

export const providerDtoSchema = z.object({
  id: z.string(),
  kind: providerKindSchema,
  displayName: z.string(),
  pointsCurrency: z.string(),
  /** Editorial estimate of one point's redemption value, in US cents. */
  estimatedCentsPerPoint: z.number().positive(),
  /** Months of inactivity before expiry; null if the program never expires. */
  inactivityExpiryMonths: z.number().int().positive().nullable(),
});

export const balanceDtoSchema = z.object({
  points: z.number().int().nonnegative(),
  source: z.enum(["sync", "manual"]),
  capturedAt: isoDateTimeSchema,
});

export const balanceDeltaDtoSchema = z.object({
  points: z.number().int(),
  /** Relative change as a fraction of the baseline; null when baseline is 0. */
  percent: z.number().nullable(),
});

export const balanceTrendDtoSchema = z.object({
  sincePrevious: balanceDeltaDtoSchema.nullable(),
  since30Days: balanceDeltaDtoSchema.nullable(),
  since90Days: balanceDeltaDtoSchema.nullable(),
});

export const loyaltyAccountDtoSchema = z.object({
  id: z.string(),
  provider: providerDtoSchema,
  membershipNumber: z.string(),
  hasStoredCredential: z.boolean(),
  latestBalance: balanceDtoSchema.nullable(),
  /** Approximate USD value of the latest balance, in whole cents. */
  estimatedValueCents: z.number().int().nonnegative(),
  /** User override of cents-per-point for this provider; null when unset. */
  customCentsPerPoint: z.number().nullable(),
  trend: balanceTrendDtoSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  daysUntilExpiry: z.number().int().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  pinnedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const linkLoyaltyAccountRequestSchema = z
  .object({
    providerId: z.string().min(1),
    membershipNumber: z.string().min(1),
    credentialRef: z.string().min(1).nullish(),
  })
  .strict();

export const syncLoyaltyAccountRequestSchema = z
  .object({
    /**
     * Surfaces with device-bound vaults (Apple Keychain, Chrome password
     * manager) resolve the credential locally and submit it here for one-time
     * use. It is never persisted server-side.
     */
    transientCredential: z
      .object({
        username: z.string().min(1),
        secret: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateLoyaltyAccountRequestSchema = z
  .object({
    membershipNumber: z.string().min(1).optional(),
    /** `null` clears the stored credential reference. */
    credentialRef: z.string().min(1).nullish(),
    /** ISO UTC expiry; `null` clears it. */
    expiresAt: isoDateTimeSchema.nullish(),
    /** Free-text notes; `null` clears. */
    notes: z.string().max(2000).nullish(),
    /** Replace the full tag set. */
    tags: z.array(z.string().min(1).max(32)).max(20).optional(),
    /** Pin or unpin the account on the dashboard. */
    pinned: z.boolean().optional(),
  })
  .strict();

export const bulkUpdateMembershipRequestSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            accountId: z.string().min(1),
            membershipNumber: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const bulkUpdateMembershipResultDtoSchema = z.object({
  updated: z.number().int().nonnegative(),
  failures: z.array(
    z.object({
      accountId: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

export const customValuationDtoSchema = z.object({
  providerId: z.string(),
  centsPerPoint: z.number().positive(),
  updatedAt: isoDateTimeSchema,
});

export const setCustomValuationRequestSchema = z
  .object({
    /** Override redemption value of one point, in US cents (0 < v ≤ 100). */
    centsPerPoint: z.number().positive().max(100),
  })
  .strict();

export const awardWatchDtoSchema = z.object({
  id: z.string(),
  url: z.url(),
  label: z.string(),
  minCentsPerPoint: z.number().positive(),
  bestSeenCentsPerPoint: z.number().positive().nullable(),
  lastCheckedAt: isoDateTimeSchema.nullable(),
  lastNotifiedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const createAwardWatchRequestSchema = z
  .object({
    url: z.url(),
    label: z.string().min(1).max(120),
    /** Notify when a scraped deal reaches this realized ¢/pt (0 < v ≤ 100). */
    minCentsPerPoint: z.number().positive().max(100),
  })
  .strict();

export const recordManualBalanceRequestSchema = z
  .object({
    points: z.number().int().nonnegative(),
    /**
     * When the balance was observed (strict ISO-8601 UTC). Omit for "now";
     * backfilled values must not be in the future.
     */
    capturedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const balanceHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(365).optional(),
});

export const exportQuerySchema = z.object({
  /** Wire format; defaults to json. */
  format: z.enum(["json", "csv"]).optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const activityEventDtoSchema = z.object({
  id: z.string(),
  type: z.enum([
    "account_linked",
    "account_unlinked",
    "account_updated",
    "account_restored",
    "balance_synced",
    "balance_manual",
  ]),
  accountId: z.string().nullable(),
  providerId: z.string().nullable(),
  summary: z.string(),
  occurredAt: isoDateTimeSchema,
});

export const portfolioExportDtoSchema = z.object({
  exportedAt: isoDateTimeSchema,
  accounts: z.array(
    z.object({
      account: loyaltyAccountDtoSchema,
      history: z.array(balanceDtoSchema),
    }),
  ),
});

export const displayCurrencySchema = z.enum([
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
]);

export const displayValueDtoSchema = z.object({
  currency: displayCurrencySchema,
  /** Decimal amount in the display currency (2dp; 0dp for JPY). */
  amount: z.number(),
  /** Units of the currency per 1 USD used for the conversion. */
  ratePerUsd: z.number().positive(),
});

export const userSettingsDtoSchema = z.object({
  displayCurrency: displayCurrencySchema,
  updatedAt: isoDateTimeSchema,
});

export const updateUserSettingsRequestSchema = z
  .object({
    displayCurrency: displayCurrencySchema,
  })
  .strict();

export const portfolioSummaryDtoSchema = z.object({
  totalPoints: z.number().int().nonnegative(),
  /** Approximate USD value of the whole portfolio, in whole cents. */
  totalValueCents: z.number().int().nonnegative(),
  accountCount: z.number().int().nonnegative(),
  byKind: z.record(
    providerKindSchema,
    z.object({
      accounts: z.number().int().nonnegative(),
      points: z.number().int().nonnegative(),
      valueCents: z.number().int().nonnegative(),
    }),
  ),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  /** Total value converted to the user's display currency; null for USD. */
  display: displayValueDtoSchema.nullable().optional(),
});

export const syncOutcomeDtoSchema = z.discriminatedUnion("ok", [
  z.object({
    accountId: z.string(),
    ok: z.literal(true),
    balance: balanceDtoSchema,
  }),
  z.object({
    accountId: z.string(),
    ok: z.literal(false),
    errorCode: z.string(),
  }),
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

/**
 * Canonical HTTP status for every error code the API emits. Living in the
 * contracts makes the mapping part of the wire contract itself: servers use
 * it to respond, clients can rely on it, and docs/api.md mirrors it.
 */
export const HTTP_STATUS_BY_ERROR_CODE = {
  UNAUTHENTICATED: 401,
  INVALID_REQUEST: 400,
  PROVIDER_NOT_SUPPORTED: 422,
  INVALID_MEMBERSHIP_NUMBER: 422,
  INVALID_VALUATION: 422,
  INVALID_DISPLAY_CURRENCY: 422,
  INVALID_AWARD_WATCH: 422,
  AWARD_WATCH_NOT_FOUND: 404,
  INVALID_BALANCE: 422,
  INVALID_CAPTURE_TIME: 422,
  INVALID_GOAL_TITLE: 422,
  INVALID_GOAL_TARGET: 422,
  INVALID_IMPORT: 422,
  INVALID_ACCOUNT_NOTES: 422,
  INVALID_ACCOUNT_TAG: 422,
  DEMO_PORTFOLIO_NOT_EMPTY: 409,
  ACCOUNT_NOT_RESTORABLE: 409,
  DUPLICATE_LOYALTY_ACCOUNT: 409,
  CREDENTIAL_UNAVAILABLE: 409,
  LOYALTY_ACCOUNT_NOT_FOUND: 404,
  TRIP_GOAL_NOT_FOUND: 404,
  SHARE_LINK_NOT_FOUND: 404,
  INVALID_ASSISTANT_MESSAGE: 422,
  INVALID_SCRAPE_URL: 422,
  ASSISTANT_UNAVAILABLE: 503,
  SCRAPE_FAILED: 502,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof HTTP_STATUS_BY_ERROR_CODE;

/** Unknown codes (future domain errors) default to 400. */
export function httpStatusForErrorCode(code: string): number {
  return (
    (HTTP_STATUS_BY_ERROR_CODE as Record<string, number>)[code] ?? 400
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type ProviderDto = z.infer<typeof providerDtoSchema>;
export type BalanceDto = z.infer<typeof balanceDtoSchema>;
export type LoyaltyAccountDto = z.infer<typeof loyaltyAccountDtoSchema>;
export type LinkLoyaltyAccountRequest = z.infer<
  typeof linkLoyaltyAccountRequestSchema
>;
export type SyncLoyaltyAccountRequest = z.infer<
  typeof syncLoyaltyAccountRequestSchema
>;
export type UpdateLoyaltyAccountRequest = z.infer<
  typeof updateLoyaltyAccountRequestSchema
>;
export type BulkUpdateMembershipRequest = z.infer<
  typeof bulkUpdateMembershipRequestSchema
>;
export type BulkUpdateMembershipResultDto = z.infer<
  typeof bulkUpdateMembershipResultDtoSchema
>;
export type CustomValuationDto = z.infer<typeof customValuationDtoSchema>;
export type DisplayValueDto = z.infer<typeof displayValueDtoSchema>;
export type UserSettingsDto = z.infer<typeof userSettingsDtoSchema>;
export type UpdateUserSettingsRequest = z.infer<
  typeof updateUserSettingsRequestSchema
>;
export type AwardWatchDto = z.infer<typeof awardWatchDtoSchema>;
export type CreateAwardWatchRequest = z.infer<
  typeof createAwardWatchRequestSchema
>;
export type SetCustomValuationRequest = z.infer<
  typeof setCustomValuationRequestSchema
>;
export type RecordManualBalanceRequest = z.infer<
  typeof recordManualBalanceRequestSchema
>;
export type PortfolioSummaryDto = z.infer<typeof portfolioSummaryDtoSchema>;
export type SyncOutcomeDto = z.infer<typeof syncOutcomeDtoSchema>;
export type BalanceTrendDto = z.infer<typeof balanceTrendDtoSchema>;
export type PortfolioExportDto = z.infer<typeof portfolioExportDtoSchema>;
export type ActivityEventDto = z.infer<typeof activityEventDtoSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

// ─── Read model → DTO mappers ──────────────────────────────────────────────

export function toProviderDto(provider: ProviderReadModel): ProviderDto {
  return { ...provider };
}

export function toBalanceDto(balance: BalanceReadModel): BalanceDto {
  return {
    points: balance.points,
    source: balance.source,
    capturedAt: balance.capturedAt.toISOString(),
  };
}

export function toLoyaltyAccountDto(
  account: LoyaltyAccountReadModel,
): LoyaltyAccountDto {
  return {
    id: account.id,
    provider: toProviderDto(account.provider),
    membershipNumber: account.membershipNumber,
    hasStoredCredential: account.hasStoredCredential,
    latestBalance: account.latestBalance
      ? toBalanceDto(account.latestBalance)
      : null,
    estimatedValueCents: account.estimatedValueCents,
    customCentsPerPoint: account.customCentsPerPoint,
    trend: account.trend,
    expiresAt: account.expiresAt?.toISOString() ?? null,
    daysUntilExpiry: account.daysUntilExpiry,
    notes: account.notes,
    tags: [...account.tags],
    pinnedAt: account.pinnedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}

export function toPortfolioExportDto(
  exported: import("../application/loyalty/export-portfolio").PortfolioExportReadModel,
): PortfolioExportDto {
  return {
    exportedAt: exported.exportedAt.toISOString(),
    accounts: exported.accounts.map((entry) => ({
      account: toLoyaltyAccountDto(entry.account),
      history: entry.history.map(toBalanceDto),
    })),
  };
}

export function toActivityEventDto(
  event: import("../application/loyalty/read-models").ActivityEventReadModel,
): ActivityEventDto {
  return {
    id: event.id,
    type: event.type,
    accountId: event.accountId,
    providerId: event.providerId,
    summary: event.summary,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/**
 * Flattens a portfolio export into CSV (one row per balance snapshot, plus
 * a row for accounts that have no history yet).
 */
export function toPortfolioExportCsv(
  exported: import("../application/loyalty/export-portfolio").PortfolioExportReadModel,
): string {
  const header = [
    "accountId",
    "providerId",
    "providerKind",
    "providerName",
    "membershipNumber",
    "points",
    "source",
    "capturedAt",
    "estimatedValueCents",
  ].join(",");

  const rows: string[] = [header];
  for (const entry of exported.accounts) {
    const { account, history } = entry;
    if (history.length === 0) {
      rows.push(
        [
          account.id,
          account.provider.id,
          account.provider.kind,
          csvEscape(account.provider.displayName),
          csvEscape(account.membershipNumber),
          "",
          "",
          "",
          String(account.estimatedValueCents),
        ].join(","),
      );
      continue;
    }
    for (const snap of history) {
      rows.push(
        [
          account.id,
          account.provider.id,
          account.provider.kind,
          csvEscape(account.provider.displayName),
          csvEscape(account.membershipNumber),
          String(snap.points),
          snap.source,
          snap.capturedAt.toISOString(),
          String(account.estimatedValueCents),
        ].join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function toPortfolioSummaryDto(
  summary: PortfolioSummaryReadModel,
  display: DisplayValueDto | null = null,
): PortfolioSummaryDto {
  return {
    totalPoints: summary.totalPoints,
    totalValueCents: summary.totalValueCents,
    accountCount: summary.accountCount,
    byKind: summary.byKind,
    lastSyncedAt: summary.lastSyncedAt?.toISOString() ?? null,
    display,
  };
}

export function toUserSettingsDto(settings: {
  readonly displayCurrency: DisplayValueDto["currency"];
  readonly updatedAt: Date;
}): UserSettingsDto {
  return {
    displayCurrency: settings.displayCurrency,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function toSyncOutcomeDto(outcome: SyncOutcome): SyncOutcomeDto {
  return outcome.ok
    ? {
        accountId: outcome.accountId,
        ok: true,
        balance: toBalanceDto(outcome.balance),
      }
    : outcome;
}

// ─── Trip goals ────────────────────────────────────────────────────────────

export const tripGoalStatusSchema = z.enum(["active", "achieved", "archived"]);

export const tripGoalDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  targetPoints: z.number().int().positive(),
  targetDate: z.string().nullable(),
  accountIds: z.array(z.string()),
  status: tripGoalStatusSchema,
  notes: z.string().nullable(),
  currentPoints: z.number().int().nonnegative(),
  remainingPoints: z.number().int().nonnegative(),
  percentComplete: z.number().nonnegative(),
  achieved: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createTripGoalRequestSchema = z
  .object({
    title: z.string().min(1).max(120),
    targetPoints: z.number().int().positive(),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    accountIds: z.array(z.string().min(1)).optional(),
    notes: z.string().max(2000).nullish(),
  })
  .strict();

export const updateTripGoalRequestSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    targetPoints: z.number().int().positive().optional(),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
    accountIds: z.array(z.string().min(1)).optional(),
    status: tripGoalStatusSchema.optional(),
    notes: z.string().max(2000).nullish(),
  })
  .strict();

export const importPortfolioRequestSchema = z
  .object({
    csv: z.string().min(1),
  })
  .strict();

export const importPortfolioResultDtoSchema = z.object({
  accountsLinked: z.number().int().nonnegative(),
  balancesRecorded: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
});

export type TripGoalDto = z.infer<typeof tripGoalDtoSchema>;
export type CreateTripGoalRequest = z.infer<typeof createTripGoalRequestSchema>;
export type UpdateTripGoalRequest = z.infer<typeof updateTripGoalRequestSchema>;
export type ImportPortfolioRequest = z.infer<
  typeof importPortfolioRequestSchema
>;
export type ImportPortfolioResultDto = z.infer<
  typeof importPortfolioResultDtoSchema
>;

export function toTripGoalDto(
  goal: import("../application/loyalty/create-trip-goal").TripGoalReadModel,
): TripGoalDto {
  return {
    id: goal.id,
    title: goal.title,
    targetPoints: goal.targetPoints,
    targetDate: goal.targetDate,
    accountIds: [...goal.accountIds],
    status: goal.status,
    notes: goal.notes,
    currentPoints: goal.currentPoints,
    remainingPoints: goal.remainingPoints,
    percentComplete: goal.percentComplete,
    achieved: goal.achieved,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

// ─── Portfolio shares ──────────────────────────────────────────────────────

export const portfolioShareDtoSchema = z.object({
  id: z.string(),
  token: z.string(),
  label: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  active: z.boolean(),
});

export const createPortfolioShareRequestSchema = z
  .object({
    label: z.string().max(80).nullish(),
    expiresInDays: z.number().int().positive().max(365).nullish(),
  })
  .strict();

export const publicPortfolioSnapshotDtoSchema = z.object({
  label: z.string().nullable(),
  totalPoints: z.number().int().nonnegative(),
  totalValueCents: z.number().int().nonnegative(),
  accountCount: z.number().int().nonnegative(),
  byKind: z.record(
    providerKindSchema,
    z.object({
      accounts: z.number().int().nonnegative(),
      points: z.number().int().nonnegative(),
      valueCents: z.number().int().nonnegative(),
    }),
  ),
  programs: z.array(
    z.object({
      displayName: z.string(),
      kind: providerKindSchema,
      points: z.number().int().nonnegative(),
      valueCents: z.number().int().nonnegative(),
    }),
  ),
  generatedAt: isoDateTimeSchema,
});

export const deletedAccountDtoSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  deletedAt: isoDateTimeSchema,
  restorable: z.boolean(),
});

export type PortfolioShareDto = z.infer<typeof portfolioShareDtoSchema>;
export type CreatePortfolioShareRequest = z.infer<
  typeof createPortfolioShareRequestSchema
>;
export type PublicPortfolioSnapshotDto = z.infer<
  typeof publicPortfolioSnapshotDtoSchema
>;
export type DeletedAccountDto = z.infer<typeof deletedAccountDtoSchema>;

export function toPortfolioShareDto(
  share: import("../application/loyalty/portfolio-share").PortfolioShareReadModel,
): PortfolioShareDto {
  return {
    id: share.id,
    token: share.token,
    label: share.label,
    createdAt: share.createdAt.toISOString(),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    active: share.active,
  };
}

export function toPublicPortfolioSnapshotDto(
  snapshot: import("../application/loyalty/portfolio-share").PublicPortfolioSnapshot,
): PublicPortfolioSnapshotDto {
  return {
    label: snapshot.label,
    totalPoints: snapshot.totalPoints,
    totalValueCents: snapshot.totalValueCents,
    accountCount: snapshot.accountCount,
    byKind: snapshot.byKind,
    programs: snapshot.programs.map((program) => ({ ...program })),
    generatedAt: snapshot.generatedAt.toISOString(),
  };
}

export function toDeletedAccountDto(account: {
  id: string;
  providerId: string;
  providerName: string;
  deletedAt: Date;
  restorable: boolean;
}): DeletedAccountDto {
  return {
    id: account.id,
    providerId: account.providerId,
    providerName: account.providerName,
    deletedAt: account.deletedAt.toISOString(),
    restorable: account.restorable,
  };
}

// ─── Assistant, deals, scraping ────────────────────────────────────────────

export const assistantMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(4000),
  })
  .strict();

export const chatAssistantRequestSchema = z
  .object({
    message: z.string().min(1).max(4000),
    history: z.array(assistantMessageSchema).max(16).optional(),
  })
  .strict();

export const chatAssistantResponseSchema = z.object({
  reply: z.string(),
});

export const scrapeDealRequestSchema = z
  .object({
    url: z.url(),
    providerId: z.string().min(1).nullish(),
  })
  .strict();

export const dealCandidateDtoSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "transfer_bonus",
    "award_sweet_spot",
    "hotel_redemption",
    "portal_sale",
    "scraped",
  ]),
  title: z.string(),
  summary: z.string(),
  providerId: z.string().nullable(),
  pointsCost: z.number().int().positive().nullable(),
  cashEquivalentCents: z.number().int().nonnegative().nullable(),
  sourceUrl: z.string().nullable(),
  transferFromProviderId: z.string().nullable(),
});

export const rankedDealDtoSchema = z.object({
  deal: dealCandidateDtoSchema,
  realizedCentsPerPoint: z.number().nullable(),
  affordable: z.boolean(),
  affordabilityNote: z.string(),
  score: z.number(),
});

export const transferOptionDtoSchema = z.object({
  fromProviderId: z.string(),
  fromDisplayName: z.string(),
  toProviderId: z.string(),
  toDisplayName: z.string(),
  sourcePoints: z.number().int().nonnegative(),
  destinationPoints: z.number().int().nonnegative(),
  effectiveCentsPerPoint: z.number(),
  estimatedValueCents: z.number().int().nonnegative(),
  bonusMultiplier: z.number(),
  bonusLabel: z.string().nullable(),
  notes: z.string().nullable(),
});

export const valueAdviceDtoSchema = z.object({
  transfers: z.array(transferOptionDtoSchema),
  deals: z.array(rankedDealDtoSchema),
});

export const ingestDealPageResultDtoSchema = z.object({
  pageTitle: z.string(),
  deals: z.array(dealCandidateDtoSchema),
  markdownExcerpt: z.string(),
});

export type ChatAssistantRequest = z.infer<typeof chatAssistantRequestSchema>;
export type ChatAssistantResponse = z.infer<typeof chatAssistantResponseSchema>;
export type ScrapeDealRequest = z.infer<typeof scrapeDealRequestSchema>;
export type DealCandidateDto = z.infer<typeof dealCandidateDtoSchema>;
export type RankedDealDto = z.infer<typeof rankedDealDtoSchema>;
export type TransferOptionDto = z.infer<typeof transferOptionDtoSchema>;
export type ValueAdviceDto = z.infer<typeof valueAdviceDtoSchema>;
export type IngestDealPageResultDto = z.infer<
  typeof ingestDealPageResultDtoSchema
>;

export function toDealCandidateDto(
  deal: import("../domain/loyalty/deals").DealCandidate,
): DealCandidateDto {
  return {
    id: deal.id,
    kind: deal.kind,
    title: deal.title,
    summary: deal.summary,
    providerId: deal.providerId,
    pointsCost: deal.pointsCost,
    cashEquivalentCents: deal.cashEquivalentCents,
    sourceUrl: deal.sourceUrl,
    transferFromProviderId: deal.transferFromProviderId,
  };
}

export function toRankedDealDto(
  ranked: import("../domain/loyalty/deals").RankedDeal,
): RankedDealDto {
  return {
    deal: toDealCandidateDto(ranked.deal),
    realizedCentsPerPoint: ranked.realizedCentsPerPoint,
    affordable: ranked.affordable,
    affordabilityNote: ranked.affordabilityNote,
    score: ranked.score,
  };
}

export function toTransferOptionDto(
  option: import("../domain/loyalty/transfer-partners").TransferOption,
): TransferOptionDto {
  return {
    fromProviderId: option.from.id,
    fromDisplayName: option.from.displayName,
    toProviderId: option.to.id,
    toDisplayName: option.to.displayName,
    sourcePoints: option.sourcePoints,
    destinationPoints: option.destinationPoints,
    effectiveCentsPerPoint: option.effectiveCentsPerPoint,
    estimatedValueCents: option.estimatedValueCents,
    bonusMultiplier: option.bonusMultiplier,
    bonusLabel: option.bonusLabel,
    notes: option.edge.notes ?? null,
  };
}

export function toValueAdviceDto(
  advice: import("../application/loyalty/assistant").ValueAdviceReadModel,
): ValueAdviceDto {
  return {
    transfers: advice.transfers.map(toTransferOptionDto),
    deals: advice.deals.map(toRankedDealDto),
  };
}

export function toIngestDealPageResultDto(
  result: import("../application/loyalty/ingest-deal-page").IngestDealPageResult,
): IngestDealPageResultDto {
  return {
    pageTitle: result.pageTitle,
    deals: result.deals.map(toDealCandidateDto),
    markdownExcerpt: result.markdownExcerpt,
  };
}

// The OpenAPI generator (`buildOpenApiDocument`) lives in ./openapi and is
// exposed via the "@pointup/core/openapi" subpath. It is intentionally NOT
// re-exported here: it imports from this module, so re-exporting would create
// an import cycle (index -> openapi -> index) that fails at load with a TDZ
// "Cannot access '...' before initialization" error.

export function toCustomValuationDto(valuation: {
  readonly providerId: string;
  readonly centsPerPoint: number;
  readonly updatedAt: Date;
}): CustomValuationDto {
  return {
    providerId: valuation.providerId,
    centsPerPoint: valuation.centsPerPoint,
    updatedAt: valuation.updatedAt.toISOString(),
  };
}

export function toAwardWatchDto(watch: {
  readonly id: string;
  readonly url: string;
  readonly label: string;
  readonly minCentsPerPoint: number;
  readonly bestSeenCentsPerPoint: number | null;
  readonly lastCheckedAt: Date | null;
  readonly lastNotifiedAt: Date | null;
  readonly createdAt: Date;
}): AwardWatchDto {
  return {
    id: watch.id,
    url: watch.url,
    label: watch.label,
    minCentsPerPoint: watch.minCentsPerPoint,
    bestSeenCentsPerPoint: watch.bestSeenCentsPerPoint,
    lastCheckedAt: watch.lastCheckedAt?.toISOString() ?? null,
    lastNotifiedAt: watch.lastNotifiedAt?.toISOString() ?? null,
    createdAt: watch.createdAt.toISOString(),
  };
}
