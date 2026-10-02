/**
 * Editorial + scraped deal candidates for bang-for-buck ranking.
 * Pure domain types — no IO.
 */

import { InvalidBalanceError } from "../errors";
import { exactPoints, safePoints } from "../shared/point-math";
import { findProvider, type ProviderId } from "./provider";
import { describeBonus, indexBestBonuses, type TransferBonus } from "./transfer-bonus";
import { resolveTransferEdge, type TransferAccountContext, type TransferEligibilityMetadata, type TransferEligibilityWarning } from "./transfer-eligibility";
import { convertPoints, edgeRatio, findTransferEdge } from "./transfer-partners";

export const DEAL_KINDS = [
  "transfer_bonus",
  "award_sweet_spot",
  "hotel_redemption",
  "portal_sale",
  "scraped",
] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export interface DealCandidate {
  readonly id: string;
  readonly kind: DealKind;
  readonly title: string;
  readonly summary: string;
  /** Program that spends the points, when known. */
  readonly providerId: ProviderId | null;
  /** Points required for the redemption, when known. */
  readonly pointsCost: number | null;
  /** Cash price avoided / equivalent, in whole US cents. */
  readonly cashEquivalentCents: number | null;
  readonly sourceUrl: string | null;
  /** Optional transfer source (card currency) for transfer-bonus deals. */
  readonly transferFromProviderId: ProviderId | null;
}

export interface RankedDeal {
  readonly deal: DealCandidate;
  /** Realized cents-per-point when both cost and cash value are known. */
  readonly realizedCentsPerPoint: number | null;
  /** Whether the user currently holds enough points (direct or via transfer). */
  readonly affordable: boolean;
  readonly affordabilityNote: string;
  readonly score: number;
  readonly transferRequirement?: DealTransferRequirement | null;
  readonly eligibilityWarnings?: readonly TransferEligibilityWarning[];
  readonly transferUnavailableReason?: TransferEligibilityWarning["code"] | "NO_TRANSFER_ROUTE" | "SOURCE_ACCOUNT_REQUIRED" | "AMOUNT_OUT_OF_RANGE" | null;
}

export interface DealTransferRequirement {
  readonly fromProviderId: ProviderId;
  readonly toProviderId: ProviderId;
  readonly sourcePointsRequired: number;
  readonly sourcePointsAvailable: number;
  readonly destinationPointsNeeded: number;
  readonly destinationPointsProduced: number;
  readonly ratioFrom: number;
  readonly ratioTo: number;
  readonly bonusPermille: number;
  readonly bonusVerified: boolean | null;
  readonly bonusLabel: string | null;
  readonly eligibility: TransferEligibilityMetadata;
  readonly minimumSourcePoints: number | null;
  readonly incrementSourcePoints: number | null;
  readonly limitsVerified: false;
  readonly caveats: readonly string[];
}
export interface DealRankingContext {
  readonly now?: Date;
  readonly bonuses?: readonly TransferBonus[];
  readonly accountContexts?: ReadonlyMap<string, TransferAccountContext>;
}

export function realizedCpp(deal: DealCandidate): number | null {
  if (
    deal.pointsCost == null ||
    deal.pointsCost <= 0 ||
    deal.cashEquivalentCents == null
  ) {
    return null;
  }
  return (
    Math.round((deal.cashEquivalentCents / deal.pointsCost) * 1000) / 1000
  );
}

/**
 * Rank deals for a user given their balances (providerId → points).
 * Higher score = better bang for the buck relative to editorial CPP.
 */
export function rankDeals(
  deals: readonly DealCandidate[],
  balances: ReadonlyMap<string, number>,
  editorialCppByProvider: ReadonlyMap<string, number>,
  context: DealRankingContext = {},
): RankedDeal[] {
  const now = context.now ?? new Date();
  const bestBonuses = indexBestBonuses(context.bonuses ?? [], now);
  return deals
    .map((deal) => {
      const cpp = realizedCpp(deal);
      const editorial =
        deal.providerId != null
          ? (editorialCppByProvider.get(deal.providerId) ?? 1)
          : 1;

      let affordable = false;
      let affordabilityNote = "Link a matching program to check affordability";
      let transferRequirement: DealTransferRequirement | null = null;
      let transferUnavailableReason: RankedDeal["transferUnavailableReason"] = null;
      const eligibilityWarnings: TransferEligibilityWarning[] = [];

      if (deal.providerId && deal.pointsCost != null && deal.pointsCost > 0) {
        exactPoints(deal.pointsCost);
        const direct = balances.get(deal.providerId) ?? 0;
        exactPoints(direct);
        if (direct >= deal.pointsCost) {
          affordable = true;
          affordabilityNote = `Your saved ${deal.providerId} balance has ${direct.toLocaleString("en-US")} points. Verify current balance, price and availability before redeeming.`;
        } else if (deal.transferFromProviderId) {
          const candidate = findTransferEdge(deal.transferFromProviderId, deal.providerId);
          const hasSourceAccount = balances.has(deal.transferFromProviderId);
          const resolution = candidate && hasSourceAccount ? resolveTransferEdge(candidate, context.accountContexts?.get(deal.transferFromProviderId) ?? {}, now) : null;
          if (!candidate) {
            transferUnavailableReason = "NO_TRANSFER_ROUTE";
            affordabilityNote = `No supported transfer route from ${deal.transferFromProviderId} to ${deal.providerId}. Need ${deal.pointsCost.toLocaleString("en-US")} destination points; saved destination balance is ${direct.toLocaleString("en-US")}.`;
          } else if (!resolution) {
            transferUnavailableReason = "SOURCE_ACCOUNT_REQUIRED";
            affordabilityNote = `Link ${deal.transferFromProviderId} and record its balance to check this transfer; saved destination balance is ${direct.toLocaleString("en-US")}.`;
          } else if (resolution.status === "unavailable") {
            transferUnavailableReason = resolution.warning.code;
            eligibilityWarnings.push(resolution.warning);
            affordabilityNote = resolution.warning.message;
          } else {
            const edge = resolution.edge;
            const transferable = balances.get(deal.transferFromProviderId) ?? 0;
            exactPoints(transferable);
            const missing = deal.pointsCost - direct;
            const bonus = bestBonuses.get(`${edge.fromProviderId}>${edge.toProviderId}`);
            const permille = bonus?.multiplierPermille ?? 1000;
            // Invert the same two floors as convertPoints, then apply only
            // published catalog limits. Unknown increments are not invented.
            const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
            const ratio = edgeRatio(edge);
            const baseNeeded = ceil(exactPoints(missing) * 1000n, exactPoints(permille));
            const required = ceil(baseNeeded * exactPoints(ratio.den), exactPoints(ratio.num));
            const min = exactPoints(edge.minimumSourcePoints ?? 0);
            const inc = exactPoints(edge.incrementSourcePoints ?? 1);
            try {
              if (inc === 0n) throw new InvalidBalanceError();
              const sourcePointsRequired = safePoints(ceil(required > min ? required : min, inc) * inc);
              const produced = convertPoints(edge, sourcePointsRequired, permille);
              const bonusLabel = bonus ? describeBonus(bonus) : null;
              transferRequirement = {
                fromProviderId: edge.fromProviderId, toProviderId: edge.toProviderId,
                sourcePointsRequired, sourcePointsAvailable: transferable,
                destinationPointsNeeded: missing, destinationPointsProduced: produced,
                ratioFrom: edge.ratioFrom, ratioTo: edge.ratioTo, bonusPermille: permille,
                bonusVerified: bonus ? bonus.verifiedAt !== null : null, bonusLabel, eligibility: edge.eligibility,
                minimumSourcePoints: edge.minimumSourcePoints ?? null,
                incrementSourcePoints: edge.incrementSourcePoints ?? null, limitsVerified: false,
                caveats: ["Saved balances may be stale; this is estimated balance sufficiency, not a transfer or booking.",
                  "Issuer access, transfer minimums/increments and award availability are not verified. No cards are combined automatically.",
                  ...(bonus && bonus.verifiedAt === null ? ["The applied bonus is unverified; confirm it with the issuer."] : [])],
              };
              affordable = transferable >= sourcePointsRequired && produced >= missing;
              const sourceName = findProvider(edge.fromProviderId)?.displayName ?? edge.fromProviderId;
              const directText = direct > 0 ? `Use ${direct.toLocaleString("en-US")} saved destination points and ` : "";
              affordabilityNote = `${directText}need at least ${sourcePointsRequired.toLocaleString("en-US")} ${sourceName} points for ${missing.toLocaleString("en-US")} destination points at ${edge.ratioFrom}:${edge.ratioTo}${bonusLabel ? ` with ${bonusLabel}${bonus?.verifiedAt ? "" : " (unverified)"}` : ""}; saved source balance is ${transferable.toLocaleString("en-US")}. Estimate only; verify current balances, issuer limits and availability.`;
            } catch (error) {
              if (!(error instanceof InvalidBalanceError)) throw error;
              transferUnavailableReason = "AMOUNT_OUT_OF_RANGE";
              affordabilityNote = "This transfer requirement exceeds the supported safe point range; no affordable transfer estimate is available.";
            }
          }
        } else {
          affordabilityNote = `Need ${deal.pointsCost.toLocaleString("en-US")}; have ${direct.toLocaleString("en-US")}`;
        }
      }

      // Score: premium for high realized CPP vs editorial, plus affordability boost.
      const cppScore = cpp != null ? cpp / Math.max(editorial, 0.1) : 0.5;
      const score =
        Math.round(
          (cppScore * 10 + (affordable ? 3 : 0) + (cpp != null && cpp >= 2 ? 2 : 0)) *
            10,
        ) / 10;

      return {
        deal,
        realizedCentsPerPoint: cpp,
        affordable,
        affordabilityNote,
        score,
        transferRequirement,
        eligibilityWarnings,
        transferUnavailableReason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Curated starter deals so the product works without scraping. */
export const CATALOG_DEALS: readonly DealCandidate[] = [
  {
    id: "deal-hyatt-off-peak-cat1",
    kind: "award_sweet_spot",
    title: "Hyatt off-peak Category 1",
    summary:
      "Standard rooms from 3,500 points — often beats paying cash at boutique properties.",
    providerId: "hyatt",
    pointsCost: 3_500,
    cashEquivalentCents: 18_000,
    sourceUrl: null,
    transferFromProviderId: "chase-ultimate-rewards",
  },
  {
    id: "deal-united-saver-domestic",
    kind: "award_sweet_spot",
    title: "United Saver domestic one-way",
    summary:
      "Saver awards around 7,500–12,500 miles on short-haul routes when space opens.",
    providerId: "united",
    pointsCost: 10_000,
    cashEquivalentCents: 22_000,
    sourceUrl: null,
    transferFromProviderId: "chase-ultimate-rewards",
  },
  {
    id: "deal-hilton-aspirational",
    kind: "hotel_redemption",
    title: "Hilton peak resort night",
    summary:
      "High-category resorts can clear 2+ cpp when cash rates spike on weekends.",
    providerId: "hilton",
    pointsCost: 80_000,
    cashEquivalentCents: 55_000,
    sourceUrl: null,
    transferFromProviderId: "amex-membership-rewards",
  },
  {
    id: "deal-amtrak-flex",
    kind: "award_sweet_spot",
    title: "Amtrak Northeast Flex",
    summary:
      "Guest Rewards often beats Acela cash fares above ~2.5 cpp on flexible dates.",
    providerId: "amtrak",
    pointsCost: 8_000,
    cashEquivalentCents: 22_000,
    sourceUrl: null,
    transferFromProviderId: "chase-ultimate-rewards",
  },
  {
    id: "deal-bilt-hyatt",
    // Not a bonus window (those are real data in transfer_bonus); a pattern.
    kind: "hotel_redemption",
    title: "Bilt → Hyatt for city stays",
    summary:
      "Rent-day points transferred to Hyatt frequently out-earn portal cash-out.",
    providerId: "hyatt",
    pointsCost: 15_000,
    cashEquivalentCents: 30_000,
    sourceUrl: null,
    transferFromProviderId: "bilt",
  },
];
