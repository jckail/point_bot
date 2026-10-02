import { getProviderOrThrow, type ProviderDefinition } from "./provider";
import { estimateValueCents, exactPoints } from "../shared/point-math";
import {
  describeBonus,
  indexBestBonuses,
  type TransferBonus,
  type TransferBonusSource,
} from "./transfer-bonus";
import {
  convertPoints,
  listTransferTargets,
} from "./transfer-partners";

import type { TransferBonusId } from "../shared/ids";
import { resolveTransferEdge, type ResolvedTransferEdge, type TransferAccountContext, type TransferEligibilityWarning } from "./transfer-eligibility";
/**
 * Bonus-aware ranking of transfer destinations. Kept apart from the pure
 * transfer graph (transfer-partners.ts) so the graph does not depend on the
 * bonus entity, which itself validates against the graph.
 */

export type TransferOption = {
  readonly from: ProviderDefinition;
  readonly to: ProviderDefinition;
  readonly edge: ResolvedTransferEdge;
  /** 1 when no bonus applies, else e.g. 1.3. */
  readonly bonusMultiplier: number;
  readonly bonusPermille: number;
  readonly bonusLabel: string | null;
  readonly bonusId: TransferBonusId | null;
  /** Missing legacy metadata is unknown; only an explicit true establishes verification. */
  readonly bonusVerified?: boolean | null;
  readonly bonusSource?: TransferBonusSource | null;
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
  bonuses: readonly TransferBonus[] = [],
  now: Date = new Date(),
  context: TransferAccountContext = {},
): TransferOption[] {
  return rankTransferAdvice(fromProviderId, sourcePoints, bonuses, now, context).options;
}

export function rankTransferAdvice(fromProviderId: string, sourcePoints: number,
  bonuses: readonly TransferBonus[] = [], now: Date = new Date(), context: TransferAccountContext = {},
): { options: TransferOption[]; eligibilityWarnings: TransferEligibilityWarning[] } {
  exactPoints(sourcePoints);
  if (sourcePoints === 0) return { options: [], eligibilityWarnings: [] };

  const from = getProviderOrThrow(fromProviderId);
  const bestBonus = indexBestBonuses(bonuses, now);
  const options: TransferOption[] = [];
  const eligibilityWarnings: TransferEligibilityWarning[] = [];

  for (const candidate of listTransferTargets(fromProviderId)) {
    const resolution = resolveTransferEdge(candidate, context, now);
    if (resolution.status === "unavailable") { eligibilityWarnings.push(resolution.warning); continue; }
    const edge = resolution.edge;
    // Skip edges whose destination isn't in the catalog yet.
    let to: ProviderDefinition;
    try {
      to = getProviderOrThrow(edge.toProviderId);
    } catch {
      continue;
    }

    const bonus = bestBonus.get(`${edge.fromProviderId}>${edge.toProviderId}`);
    const permille = bonus?.multiplierPermille ?? 1000;
    const destinationPoints = convertPoints(edge, sourcePoints, permille);
    const valueCents = estimateValueCents(destinationPoints, to.estimatedCentsPerPoint);
    const effectiveCentsPerPoint =
      valueCents / sourcePoints;

    options.push({
      from,
      to,
      edge,
      bonusMultiplier: permille / 1000,
      bonusPermille: permille,
      bonusLabel: bonus ? describeBonus(bonus) : null,
      bonusId: bonus?.id ?? null,
      bonusVerified: bonus ? bonus.verifiedAt !== null : null,
      bonusSource: bonus?.source ?? null,
      sourcePoints,
      destinationPoints,
      effectiveCentsPerPoint:
        Math.round(effectiveCentsPerPoint * 1000) / 1000,
      estimatedValueCents: valueCents,
    });
  }

  return { options: options.sort(
    (a, b) => b.effectiveCentsPerPoint - a.effectiveCentsPerPoint,
  ), eligibilityWarnings };
}
