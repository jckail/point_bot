import { getProviderOrThrow, type ProviderDefinition } from "./provider";

/**
 * Transfer partner graph: card currencies → airline/hotel programs.
 * Ratios are editorial (1 UR → 1 United mile). Bonus multipliers are
 * time-boxed overlays for transfer-bonus windows.
 */

export interface TransferEdge {
  readonly fromProviderId: string;
  readonly toProviderId: string;
  /** Source points required per destination point (usually 1). */
  readonly ratioFrom: number;
  /** Destination points received per ratioFrom source points (usually 1). */
  readonly ratioTo: number;
  readonly notes?: string;
}

export interface TransferBonus {
  readonly fromProviderId: string;
  readonly toProviderId: string;
  /** Multiplier on destination points, e.g. 1.3 for 30% bonus. */
  readonly multiplier: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly label: string;
}

/** Core 1:1 (and near-1:1) transfer edges for major US programs. */
export const TRANSFER_EDGES: readonly TransferEdge[] = [
  // Chase Ultimate Rewards
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "united", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "hyatt", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "hilton", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "chase-ultimate-rewards", toProviderId: "amtrak", ratioFrom: 1, ratioTo: 1 },
  // Amex Membership Rewards
  { fromProviderId: "amex-membership-rewards", toProviderId: "delta", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "hilton", ratioFrom: 1, ratioTo: 2, notes: "1 MR → 2 Hilton" },
  { fromProviderId: "amex-membership-rewards", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "amex-membership-rewards", toProviderId: "american", ratioFrom: 1, ratioTo: 1 },
  // Capital One
  { fromProviderId: "capital-one-miles", toProviderId: "united", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "capital-one-miles", toProviderId: "marriott", ratioFrom: 1, ratioTo: 1 },
  // Citi
  { fromProviderId: "citi-thankyou", toProviderId: "american", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "citi-thankyou", toProviderId: "hilton", ratioFrom: 1, ratioTo: 2, notes: "ThankYou → Hilton often 1:2" },
  // Bilt
  { fromProviderId: "bilt", toProviderId: "united", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "hyatt", ratioFrom: 1, ratioTo: 1 },
  { fromProviderId: "bilt", toProviderId: "american", ratioFrom: 1, ratioTo: 1 },
];

/**
 * Sample / evergreen bonus windows. Dates are illustrative so the ranking
 * engine always has something interesting to show in demos.
 */
export function activeTransferBonuses(now: Date = new Date()): TransferBonus[] {
  const year = now.getUTCFullYear();
  return [
    {
      fromProviderId: "chase-ultimate-rewards",
      toProviderId: "hyatt",
      multiplier: 1.3,
      startsAt: new Date(Date.UTC(year, 0, 1)),
      endsAt: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
      label: "Hyatt transfer bonus (demo)",
    },
    {
      fromProviderId: "amex-membership-rewards",
      toProviderId: "hilton",
      multiplier: 1.25,
      startsAt: new Date(Date.UTC(year, 0, 1)),
      endsAt: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
      label: "Hilton transfer bonus (demo)",
    },
  ].filter(
    (bonus) =>
      bonus.startsAt.getTime() <= now.getTime() &&
      bonus.endsAt.getTime() >= now.getTime(),
  );
}

export function listTransferTargets(fromProviderId: string): TransferEdge[] {
  return TRANSFER_EDGES.filter((edge) => edge.fromProviderId === fromProviderId);
}

export function findTransferEdge(
  fromProviderId: string,
  toProviderId: string,
): TransferEdge | null {
  return (
    TRANSFER_EDGES.find(
      (edge) =>
        edge.fromProviderId === fromProviderId &&
        edge.toProviderId === toProviderId,
    ) ?? null
  );
}

export function convertPoints(
  edge: TransferEdge,
  sourcePoints: number,
  bonusMultiplier = 1,
): number {
  if (edge.ratioFrom <= 0) return 0;
  const base = Math.floor((sourcePoints / edge.ratioFrom) * edge.ratioTo);
  return Math.floor(base * bonusMultiplier);
}

export type TransferOption = {
  readonly from: ProviderDefinition;
  readonly to: ProviderDefinition;
  readonly edge: TransferEdge;
  readonly bonusMultiplier: number;
  readonly bonusLabel: string | null;
  readonly sourcePoints: number;
  readonly destinationPoints: number;
  /** Effective cents-per-point of the *source* currency after transfer. */
  readonly effectiveCentsPerPoint: number;
  readonly estimatedValueCents: number;
};

/**
 * Given a source balance, enumerate transfer destinations ranked by
 * effective value (destination CPP × converted points / source points).
 */
export function rankTransferOptions(
  fromProviderId: string,
  sourcePoints: number,
  now: Date = new Date(),
): TransferOption[] {
  if (sourcePoints <= 0) return [];

  const from = getProviderOrThrow(fromProviderId);
  const bonuses = activeTransferBonuses(now);
  const options: TransferOption[] = [];

  for (const edge of listTransferTargets(fromProviderId)) {
    // Skip edges whose destination isn't in the catalog yet.
    let to: ProviderDefinition;
    try {
      to = getProviderOrThrow(edge.toProviderId);
    } catch {
      continue;
    }

    const bonus = bonuses.find(
      (b) =>
        b.fromProviderId === edge.fromProviderId &&
        b.toProviderId === edge.toProviderId,
    );
    const multiplier = bonus?.multiplier ?? 1;
    const destinationPoints = convertPoints(edge, sourcePoints, multiplier);
    const estimatedValueCents = Math.round(
      destinationPoints * to.estimatedCentsPerPoint,
    );
    const effectiveCentsPerPoint =
      sourcePoints === 0 ? 0 : estimatedValueCents / sourcePoints;

    options.push({
      from,
      to,
      edge,
      bonusMultiplier: multiplier,
      bonusLabel: bonus?.label ?? null,
      sourcePoints,
      destinationPoints,
      effectiveCentsPerPoint:
        Math.round(effectiveCentsPerPoint * 1000) / 1000,
      estimatedValueCents,
    });
  }

  return options.sort(
    (a, b) => b.effectiveCentsPerPoint - a.effectiveCentsPerPoint,
  );
}
