import { getProviderOrThrow, type ProviderDefinition } from "./provider";
import {
  describeBonus,
  indexBestBonuses,
  type TransferBonus,
} from "./transfer-bonus";
import {
  convertPoints,
  listTransferTargets,
  type TransferEdge,
} from "./transfer-partners";

import type { TransferBonusId } from "../shared/ids";
/**
 * Bonus-aware ranking of transfer destinations. Kept apart from the pure
 * transfer graph (transfer-partners.ts) so the graph does not depend on the
 * bonus entity, which itself validates against the graph.
 */

export type TransferOption = {
  readonly from: ProviderDefinition;
  readonly to: ProviderDefinition;
  readonly edge: TransferEdge;
  /** 1 when no bonus applies, else e.g. 1.3. */
  readonly bonusMultiplier: number;
  readonly bonusPermille: number;
  readonly bonusLabel: string | null;
  readonly bonusId: TransferBonusId | null;
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
): TransferOption[] {
  if (sourcePoints <= 0) return [];

  const from = getProviderOrThrow(fromProviderId);
  const bestBonus = indexBestBonuses(bonuses, now);
  const options: TransferOption[] = [];

  for (const edge of listTransferTargets(fromProviderId)) {
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
    const estimatedValueCents = Math.round(
      destinationPoints * to.estimatedCentsPerPoint,
    );
    const effectiveCentsPerPoint =
      sourcePoints === 0 ? 0 : estimatedValueCents / sourcePoints;

    options.push({
      from,
      to,
      edge,
      bonusMultiplier: permille / 1000,
      bonusPermille: permille,
      bonusLabel: bonus ? describeBonus(bonus) : null,
      bonusId: bonus?.id ?? null,
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
