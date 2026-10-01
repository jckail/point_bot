import { z } from "zod";

import type { PlanRedemptionResult } from "../application/loyalty/plan-redemption";
import { AWARD_CABINS, AWARD_SEARCH_STATUSES } from "../domain/loyalty/award-availability";
import {
  SWEET_SPOT_CONFIDENCE,
  SWEET_SPOT_CPP_BASES,
  SWEET_SPOT_KINDS,
  SWEET_SPOT_UNITS,
  type SweetSpot,
} from "../domain/loyalty/catalog/sweet-spots";
import {
  EXPIRY_URGENCIES,
  PLAN_STATUSES,
  PLAN_STEP_KINDS,
  REDEMPTION_GOAL_KINDS,
} from "../domain/loyalty/optimizer";
import {
  TRANSFER_BONUS_SOURCES,
  type TransferBonus,
} from "../domain/loyalty/transfer-bonus";

/** Closed sets re-exported for surfaces that only import `/contracts` (MCP). */
export { REDEMPTION_GOAL_KINDS, SWEET_SPOT_KINDS };

/**
 * Wire contracts for the redemption optimizer, sweet-spot catalog and
 * transfer bonuses. Additive to the v1 API.
 *
 * Honesty notes carried on the wire: every sweet spot is `verified: false`;
 * every plan lists `caveats` and a `confidence`; `availability` on a plan is
 * non-null only when a configured award source actually returned data.
 */

// ─── Transfer bonuses ──────────────────────────────────────────────────────

export const transferBonusDtoSchema = z.object({
  id: z.string(),
  fromProviderId: z.string(),
  toProviderId: z.string(),
  /** Integer permille: 1300 = 1.3x = a +30% bonus. */
  multiplierPermille: z.number().int(),
  bonusPercent: z.number(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  source: z.enum(TRANSFER_BONUS_SOURCES),
  sourceUrl: z.string().nullable(),
  /** Null until a human confirmed it against the issuer's announcement. */
  verifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/**
 * Bonuses are crowd/manual data: anyone with `portfolio:write` can report one,
 * it is stored as source "user" and unverified, and plans that use it say so.
 */
export const recordTransferBonusRequestSchema = z
  .object({
    fromProviderId: z.string().trim().min(1).max(64),
    toProviderId: z.string().trim().min(1).max(64),
    /** Bonus in percent, e.g. 30 for +30% (0 < v <= 200, one decimal). */
    bonusPercent: z.number().positive().max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    sourceUrl: z.url().max(2048).optional(),
  })
  .strict();

// ─── Sweet spots ───────────────────────────────────────────────────────────

export const sweetSpotDtoSchema = z.object({
  id: z.string(),
  programId: z.string(),
  kind: z.enum(SWEET_SPOT_KINDS),
  title: z.string(),
  description: z.string(),
  pointsCost: z.number().int(),
  pointsCostMin: z.number().int(),
  pointsCostMax: z.number().int(),
  unit: z.enum(SWEET_SPOT_UNITS),
  cashValueCents: z.number().int().nullable(),
  estimatedCentsPerPoint: z.number(),
  cppBasis: z.enum(SWEET_SPOT_CPP_BASES),
  constraints: z.array(z.string()),
  confidence: z.enum(SWEET_SPOT_CONFIDENCE),
  lastReviewed: z.string(),
  /** Always false: nothing in the catalog was checked against a live site. */
  verified: z.literal(false),
});

export const listSweetSpotsQuerySchema = z
  .object({
    kind: z.enum(SWEET_SPOT_KINDS).optional(),
    programId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

// ─── Optimizer ─────────────────────────────────────────────────────────────

const awardOptionDtoSchema = z.object({
  programId: z.string(),
  carrier: z.string().nullable(),
  date: z.string(),
  cabin: z.enum(AWARD_CABINS),
  pointsCost: z.number().int(),
  taxesCents: z.number().int().nullable(),
  seats: z.number().int().nullable(),
});

const planStepDtoSchema = z.object({
  kind: z.enum(PLAN_STEP_KINDS),
  text: z.string(),
});

const planBonusDtoSchema = z.object({
  id: z.string(),
  multiplierPermille: z.number().int(),
  label: z.string(),
  source: z.enum(TRANSFER_BONUS_SOURCES),
  verified: z.boolean(),
});

const planSourceDtoSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  pointsUsed: z.number().int().nonnegative(),
  destinationPoints: z.number().int().nonnegative(),
  direct: z.boolean(),
  ratioFrom: z.number().nullable(),
  ratioTo: z.number().nullable(),
  bonus: planBonusDtoSchema.nullable(),
  daysUntilExpiry: z.number().int().nullable(),
});

const coverageHintDtoSchema = z.object({
  providerId: z.string(),
  sourcePointsNeeded: z.number().int().nonnegative(),
  balanceAvailable: z.number().int().nonnegative(),
  canCoverNow: z.boolean(),
});

export const redemptionPlanDtoSchema = z.object({
  id: z.string(),
  spotId: z.string(),
  programId: z.string(),
  kind: z.enum(SWEET_SPOT_KINDS),
  title: z.string(),
  units: z.number().int().positive(),
  unit: z.enum(SWEET_SPOT_UNITS),
  status: z.enum(PLAN_STATUSES),
  steps: z.array(planStepDtoSchema),
  sources: z.array(planSourceDtoSchema),
  totalSourcePoints: z.number().int().nonnegative(),
  destinationPointsNeeded: z.number().int().nonnegative(),
  destinationPointsProvided: z.number().int().nonnegative(),
  surplusDestinationPoints: z.number().int().nonnegative(),
  valueCents: z.number().int().nonnegative(),
  effectiveCentsPerPoint: z.number(),
  opportunityCostCents: z.number().int().nonnegative(),
  netGainCents: z.number().int(),
  rankScoreCents: z.number().int(),
  shortfall: z
    .object({
      programId: z.string(),
      pointsNeeded: z.number().int().positive(),
      coverage: z.array(coverageHintDtoSchema),
    })
    .nullable(),
  expiryUrgency: z.enum(EXPIRY_URGENCIES),
  confidence: z.enum(SWEET_SPOT_CONFIDENCE),
  caveats: z.array(z.string()),
  /** Non-null only when a configured award source returned data for this plan. */
  availability: z
    .object({ checkedAt: z.iso.datetime(), options: z.array(awardOptionDtoSchema) })
    .nullable(),
});

export const planRedemptionResultDtoSchema = z.object({
  goal: z.object({
    kind: z.enum(REDEMPTION_GOAL_KINDS),
    targetProgramId: z.string().nullable(),
    minValueCpp: z.number().nullable(),
    quantity: z.number().int().nullable(),
  }),
  generatedAt: z.iso.datetime(),
  activeBonusCount: z.number().int().nonnegative(),
  plans: z.array(redemptionPlanDtoSchema),
  expiringHoldings: z.array(
    z.object({
      providerId: z.string(),
      points: z.number().int().nonnegative(),
      daysUntilExpiry: z.number().int(),
      usedByPlan: z.boolean(),
    }),
  ),
  notes: z.array(z.string()),
  /** Null unless an award search was requested. */
  availability: z
    .object({
      status: z.enum(AWARD_SEARCH_STATUSES),
      checkedAt: z.iso.datetime(),
      message: z.string().nullable(),
    })
    .nullable(),
});

const iataSchema = z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter IATA code");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

/** Query for GET /api/v1/optimizer/plan (query-string values arrive as strings). */
export const planRedemptionQuerySchema = z
  .object({
    goalKind: z.enum(REDEMPTION_GOAL_KINDS).optional(),
    targetProgramId: z.string().trim().min(1).max(64).optional(),
    minValueCpp: z.coerce.number().min(0).max(100).optional(),
    quantity: z.coerce.number().int().min(1).max(30).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    /** Optional live award search (flight goals): all five together. */
    origin: iataSchema.optional(),
    destination: iataSchema.optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    cabin: z.enum(AWARD_CABINS).optional(),
  })
  .strict()
  .refine(
    (q) => {
      const given = [q.origin, q.destination, q.dateFrom, q.dateTo, q.cabin].filter(
        (v) => v !== undefined,
      ).length;
      return given === 0 || given === 5;
    },
    { message: "origin, destination, dateFrom, dateTo and cabin must be given together" },
  );

export type TransferBonusDto = z.infer<typeof transferBonusDtoSchema>;
export type RecordTransferBonusRequest = z.infer<typeof recordTransferBonusRequestSchema>;
export type SweetSpotDto = z.infer<typeof sweetSpotDtoSchema>;
export type RedemptionPlanDto = z.infer<typeof redemptionPlanDtoSchema>;
export type PlanRedemptionResultDto = z.infer<typeof planRedemptionResultDtoSchema>;
export type PlanRedemptionQuery = z.infer<typeof planRedemptionQuerySchema>;

export function toTransferBonusDto(bonus: TransferBonus): TransferBonusDto {
  return {
    id: bonus.id,
    fromProviderId: bonus.fromProviderId,
    toProviderId: bonus.toProviderId,
    multiplierPermille: bonus.multiplierPermille,
    bonusPercent: (bonus.multiplierPermille - 1000) / 10,
    startsAt: bonus.startsAt.toISOString(),
    endsAt: bonus.endsAt.toISOString(),
    source: bonus.source,
    sourceUrl: bonus.sourceUrl,
    verifiedAt: bonus.verifiedAt?.toISOString() ?? null,
    createdAt: bonus.createdAt.toISOString(),
  };
}

/** Percent (one decimal) -> integer permille multiplier. */
export function bonusPercentToPermille(percent: number): number {
  return 1000 + Math.round(percent * 10);
}

export function toSweetSpotDto(spot: SweetSpot): SweetSpotDto {
  return { ...spot, constraints: [...spot.constraints] };
}

export function toPlanRedemptionResultDto(
  result: PlanRedemptionResult,
): PlanRedemptionResultDto {
  return {
    goal: {
      kind: result.goal.kind,
      targetProgramId: result.goal.targetProgramId ?? null,
      minValueCpp: result.goal.minValueCpp ?? null,
      quantity: result.goal.quantity ?? null,
    },
    generatedAt: result.generatedAt,
    activeBonusCount: result.activeBonusCount,
    // The domain plan shape is JSON-native; a structural copy drops readonly.
    plans: JSON.parse(JSON.stringify(result.plans)) as PlanRedemptionResultDto["plans"],
    expiringHoldings: result.expiringHoldings.map((h) => ({ ...h })),
    notes: [...result.notes],
    availability: result.availability ? { ...result.availability } : null,
  };
}
