/**
 * Editorial + scraped deal candidates for bang-for-buck ranking.
 * Pure domain types — no IO.
 */

export type DealKind =
  | "transfer_bonus"
  | "award_sweet_spot"
  | "hotel_redemption"
  | "portal_sale"
  | "scraped";

export interface DealCandidate {
  readonly id: string;
  readonly kind: DealKind;
  readonly title: string;
  readonly summary: string;
  /** Program that spends the points, when known. */
  readonly providerId: string | null;
  /** Points required for the redemption, when known. */
  readonly pointsCost: number | null;
  /** Cash price avoided / equivalent, in whole US cents. */
  readonly cashEquivalentCents: number | null;
  readonly sourceUrl: string | null;
  /** Optional transfer source (card currency) for transfer-bonus deals. */
  readonly transferFromProviderId: string | null;
}

export interface RankedDeal {
  readonly deal: DealCandidate;
  /** Realized cents-per-point when both cost and cash value are known. */
  readonly realizedCentsPerPoint: number | null;
  /** Whether the user currently holds enough points (direct or via transfer). */
  readonly affordable: boolean;
  readonly affordabilityNote: string;
  readonly score: number;
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
): RankedDeal[] {
  return deals
    .map((deal) => {
      const cpp = realizedCpp(deal);
      const editorial =
        deal.providerId != null
          ? (editorialCppByProvider.get(deal.providerId) ?? 1)
          : 1;

      let affordable = false;
      let affordabilityNote = "Link a matching program to check affordability";

      if (deal.providerId && deal.pointsCost != null) {
        const direct = balances.get(deal.providerId) ?? 0;
        if (direct >= deal.pointsCost) {
          affordable = true;
          affordabilityNote = `You have ${direct.toLocaleString("en-US")} points`;
        } else if (deal.transferFromProviderId) {
          const transferable =
            balances.get(deal.transferFromProviderId) ?? 0;
          if (transferable >= deal.pointsCost) {
            affordable = true;
            affordabilityNote = `Transfer ${deal.pointsCost.toLocaleString("en-US")} from your transferable currency`;
          } else {
            affordabilityNote = `Need ${deal.pointsCost.toLocaleString("en-US")}; have ${Math.max(direct, transferable).toLocaleString("en-US")}`;
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
    kind: "transfer_bonus",
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
