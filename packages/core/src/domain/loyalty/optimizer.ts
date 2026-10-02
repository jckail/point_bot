import { InvalidRedemptionGoalError, InvalidValuationError } from "../errors";
import { checkedPointSum, exactPoints, safePoints, estimateValueCents } from "../shared/point-math";
import { isOneOf } from "../shared/enum";
import type { AwardOption } from "./award-availability";
import {
  SWEET_SPOTS,
  type SweetSpot,
  type SweetSpotConfidence,
  type SweetSpotKind,
  type SweetSpotUnit,
} from "./catalog/sweet-spots";
import { findProvider, type ProviderId } from "./provider";
import {
  indexBestBonuses,
  describeBonus,
  type TransferBonus,
  type TransferBonusSource,
} from "./transfer-bonus";
import {
  TRANSFER_EDGES,
  convertPoints,
  edgeRatio,
} from "./transfer-partners";

import { resolveTransferEdge, type ResolvedTransferEdge, type TransferEligibilityMetadata, type TransferEligibilityWarning } from "./transfer-eligibility";
import type { CardProductId } from "./card-products";

/**
 * Redemption optimizer: pure, deterministic, integer-point math. No IO and no
 * randomness: identical input always yields identical output.
 *
 * Model. A plan books one sweet spot (a typical redemption at a program) for
 * `units` units. The program's points can come from the user's direct balance
 * in that program and from transfers out of any held currency that has an edge
 * to it (split transfers allowed). Each source point has an opportunity cost
 * (the user's own valuation of that currency, discounted when the points are
 * about to expire). We choose the funding mix with the smallest opportunity
 * cost that covers the need, then rank plans by net gain
 * (value of the redemption minus what the spent points were worth).
 *
 * Search. For each sweet spot: sources are ordered by cost per destination
 * point; we evaluate the plain greedy fill plus, for every source, "all
 * cheaper sources in full, then that source covers the remainder". That is
 * exact when yields are linear and handles transfer increments/minimums for the
 * marginal source; it is a bounded heuristic (O(n^2) per spot), not a proof of
 * global optimality.
 */

export const REDEMPTION_GOAL_KINDS = ["flight", "hotel", "any"] as const;
export type RedemptionGoalKind = (typeof REDEMPTION_GOAL_KINDS)[number];

export const PLAN_STATUSES = ["fundable", "shortfall"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const EXPIRY_URGENCIES = ["none", "soon", "urgent"] as const;
export type ExpiryUrgency = (typeof EXPIRY_URGENCIES)[number];

export const PLAN_STEP_KINDS = ["use", "transfer", "book", "note"] as const;
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

/** Source points must move in blocks of this size unless the edge says otherwise. */
export const DEFAULT_TRANSFER_INCREMENT = 1_000;
export const URGENT_DAYS = 30;
export const SOON_DAYS = 90;
const MAX_QUANTITY = 30;

export interface RedemptionGoal {
  readonly kind: RedemptionGoalKind;
  /** Only plans that spend this program's points (where the trip is booked). */
  readonly targetProgramId?: string;
  /** Drop plans whose effective cents per source point is below this. */
  readonly minValueCpp?: number;
  /** Exact number of units (nights/tickets); default is chosen from balances. */
  readonly quantity?: number;
}

export interface Holding {
  readonly cardProductId?: CardProductId | null;
  readonly providerId: ProviderId;
  readonly points: number;
  /** The user's value of one point (custom override or editorial), in cents. */
  readonly centsPerPoint: number;
  /** Days until projected inactivity expiry; null when none; negative = past. */
  readonly daysUntilExpiry: number | null;
}

export interface OptimizerInput {
  readonly holdings: readonly Holding[];
  readonly goal: RedemptionGoal;
  readonly bonuses: readonly TransferBonus[];
  readonly sweetSpots?: readonly SweetSpot[];
  readonly now: Date;
  readonly maxPlans?: number;
}

export interface PlanStep {
  readonly kind: PlanStepKind;
  readonly text: string;
}

export interface PlanBonus {
  readonly id: string;
  readonly multiplierPermille: number;
  readonly label: string;
  readonly source: TransferBonusSource;
  readonly verified: boolean;
}

export interface PlanSource {
  readonly eligibility: TransferEligibilityMetadata | null;
  readonly providerId: ProviderId;
  readonly displayName: string;
  /** Source points spent (never above the balance). */
  readonly pointsUsed: number;
  /** Points credited to the target program for them. */
  readonly destinationPoints: number;
  readonly direct: boolean;
  readonly ratioFrom: number | null;
  readonly ratioTo: number | null;
  readonly bonus: PlanBonus | null;
  readonly daysUntilExpiry: number | null;
}

export interface CoverageHint {
  readonly providerId: ProviderId;
  /** Source points a transfer would need to cover the missing amount. */
  readonly sourcePointsNeeded: number;
  /** What the user still has of that currency after this plan. */
  readonly balanceAvailable: number;
  readonly canCoverNow: boolean;
}

export interface Shortfall {
  readonly programId: ProviderId;
  /** Destination points still missing. */
  readonly pointsNeeded: number;
  readonly coverage: readonly CoverageHint[];
}

export interface RedemptionPlan {
  readonly eligibilityWarnings: readonly TransferEligibilityWarning[];
  readonly id: string;
  readonly spotId: string;
  readonly programId: ProviderId;
  readonly kind: SweetSpotKind;
  readonly title: string;
  readonly units: number;
  readonly unit: SweetSpotUnit;
  readonly status: PlanStatus;
  readonly steps: readonly PlanStep[];
  readonly sources: readonly PlanSource[];
  readonly totalSourcePoints: number;
  readonly destinationPointsNeeded: number;
  readonly destinationPointsProvided: number;
  readonly surplusDestinationPoints: number;
  /** Estimated value of the redemption, whole US cents. */
  readonly valueCents: number;
  /** Value per source point spent, in cents (3 dp). */
  readonly effectiveCentsPerPoint: number;
  /** What the spent source points are worth to the user, whole cents. */
  readonly opportunityCostCents: number;
  readonly netGainCents: number;
  /** netGain with expiring points discounted; the ranking key. */
  readonly rankScoreCents: number;
  readonly shortfall: Shortfall | null;
  readonly expiryUrgency: ExpiryUrgency;
  readonly confidence: SweetSpotConfidence;
  readonly caveats: readonly string[];
  /** Real availability when an award source returned data; otherwise null. */
  readonly availability: PlanAvailability | null;
}

export interface PlanAvailability {
  readonly checkedAt: string;
  readonly options: readonly AwardOption[];
}

export interface ExpiringHolding {
  readonly providerId: ProviderId;
  readonly points: number;
  readonly daysUntilExpiry: number;
  readonly usedByPlan: boolean;
}

export interface OptimizerResult {
  readonly eligibilityWarnings: readonly TransferEligibilityWarning[];
  readonly plans: readonly RedemptionPlan[];
  readonly expiringHoldings: readonly ExpiringHolding[];
  /** Plain-language notes about the run (e.g. "no balances"). */
  readonly notes: readonly string[];
}

// ─── Validation ────────────────────────────────────────────────────────────

export function assertValidGoal(goal: RedemptionGoal): void {
  if (!isOneOf(REDEMPTION_GOAL_KINDS, goal.kind)) {
    throw new InvalidRedemptionGoalError(
      `goal kind must be one of ${REDEMPTION_GOAL_KINDS.join(", ")}`,
    );
  }
  if (goal.targetProgramId !== undefined && !findProvider(goal.targetProgramId)) {
    throw new InvalidRedemptionGoalError(
      `Unknown target program "${goal.targetProgramId}"`,
    );
  }
  if (
    goal.minValueCpp !== undefined &&
    (!Number.isFinite(goal.minValueCpp) ||
      goal.minValueCpp < 0 ||
      goal.minValueCpp > 100)
  ) {
    throw new InvalidRedemptionGoalError("minValueCpp must be between 0 and 100");
  }
  if (
    goal.quantity !== undefined &&
    (!Number.isInteger(goal.quantity) ||
      goal.quantity < 1 ||
      goal.quantity > MAX_QUANTITY)
  ) {
    throw new InvalidRedemptionGoalError(
      `quantity must be an integer between 1 and ${MAX_QUANTITY}`,
    );
  }
}

// ─── Internals ─────────────────────────────────────────────────────────────

type ResolvedGraph = ReadonlyMap<string, readonly ResolvedTransferEdge[]>;
function resolveGraph(holdings: readonly Holding[], now: Date): { edges: ResolvedGraph; warnings: TransferEligibilityWarning[] } {
  const byProvider = new Map(holdings.map(holding => [holding.providerId, holding]));
  const edges = new Map<string, ResolvedTransferEdge[]>();
  const warnings: TransferEligibilityWarning[] = [];
  for (const candidate of TRANSFER_EDGES) {
    const holding = byProvider.get(candidate.fromProviderId);
    const resolution = resolveTransferEdge(candidate, holding ?? {}, now);
    if (resolution.status === "unavailable") {
      if (holding) warnings.push(resolution.warning);
      continue;
    }
    const list = edges.get(candidate.toProviderId) ?? [];
    list.push(resolution.edge);
    edges.set(candidate.toProviderId, list);
  }
  return { edges, warnings };
}

const CONFIDENCE_RANK = {
  low: 0,
  medium: 1,
  high: 2,
} satisfies Record<SweetSpotConfidence, number>;

function minConfidence(
  a: SweetSpotConfidence,
  b: SweetSpotConfidence,
): SweetSpotConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

function urgencyFactor(days: number | null): number {
  if (days === null) return 1;
  if (days <= URGENT_DAYS) return 0.25;
  if (days <= SOON_DAYS) return 0.5;
  return 1;
}

function urgencyOf(days: number | null): ExpiryUrgency {
  if (days === null) return "none";
  if (days <= URGENT_DAYS) return "urgent";
  if (days <= SOON_DAYS) return "soon";
  return "none";
}

const URGENCY_RANK = {
  none: 0,
  soon: 1,
  urgent: 2,
} satisfies Record<ExpiryUrgency, number>;

interface Source {
  readonly holding: Holding;
  readonly edge: ResolvedTransferEdge | null;
  readonly bonus: TransferBonus | null;
  readonly permille: number;
  readonly min: number;
  readonly inc: number;
  /** Balance rounded down to a transferable block. */
  readonly usable: number;
  readonly maxDest: number;
  /** Opportunity cost, milli-cents per destination point (for ordering). */
  readonly costPerDest: number;
}

function yieldOf(source: Source, x: number): number {
  if (x <= 0) return 0;
  return source.edge ? convertPoints(source.edge, x, source.permille) : x;
}

/** Smallest transferable block of `source` whose yield covers `need`, or null. */
function minAmountFor(source: Source, need: number): number | null {
  if (need <= 0) return 0;
  if (source.maxDest < need) return null;
  const { inc, min } = source;
  let lo = Math.max(1, Math.ceil(min / inc));
  let hi = Math.floor(source.usable / inc);
  if (hi < lo) return null;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (yieldOf(source, mid * inc) >= need) hi = mid;
    else lo = mid + 1;
  }
  const x = lo * inc;
  return yieldOf(source, x) >= need ? x : null;
}

function buildSources(
  programId: ProviderId,
  holdings: readonly Holding[],
  bestBonuses: ReadonlyMap<string, TransferBonus>,
  edges: ResolvedGraph,
): Source[] {
  const byProvider = new Map(holdings.map((h) => [h.providerId, h] as const));
  const sources: Source[] = [];

  const direct = byProvider.get(programId);
  if (direct && direct.points > 0) {
    sources.push({
      holding: direct,
      edge: null,
      bonus: null,
      permille: 1000,
      min: 0,
      inc: 1,
      usable: direct.points,
      maxDest: direct.points,
      costPerDest: finiteValue(urgencyFactor(direct.daysUntilExpiry) * direct.centsPerPoint * 1000),
    });
  }

  for (const edge of edges.get(programId) ?? []) {
    const holding = byProvider.get(edge.fromProviderId);
    if (!holding || holding.points <= 0) continue;
    const inc = edge.incrementSourcePoints ?? DEFAULT_TRANSFER_INCREMENT;
    const min = edge.minimumSourcePoints ?? inc;
    const usable = safePoints(exactPoints(holding.points) / exactPoints(inc) * exactPoints(inc));
    if (usable < min || usable <= 0) continue;
    const bonus = bestBonuses.get(`${edge.fromProviderId}>${edge.toProviderId}`) ?? null;
    const permille = bonus?.multiplierPermille ?? 1000;
    const probe: Source = {
      holding,
      edge,
      bonus,
      permille,
      min,
      inc,
      usable,
      maxDest: 0,
      costPerDest: 0,
    };
    const maxDest = yieldOf(probe, usable);
    if (maxDest <= 0) continue;
    sources.push({
      ...probe,
      maxDest,
      costPerDest: finiteValue(
        ((urgencyFactor(holding.daysUntilExpiry) * holding.centsPerPoint * 1000) /
          maxDest) * usable),
    });
  }

  return sources.sort(
    (a, b) =>
      a.costPerDest - b.costPerDest ||
      Number(b.edge === null) - Number(a.edge === null) ||
      a.holding.providerId.localeCompare(b.holding.providerId),
  );
}

interface Pick {
  readonly source: Source;
  readonly amount: number;
}

/** Preserve normal milli-cent rounding; use exact decimal intermediates beyond safe integer precision. */
function milliCost(source: Source, amount: number): bigint {
  const factor = urgencyFactor(source.holding.daysUntilExpiry);
  const rate = source.holding.centsPerPoint;
  const normal = Math.round(amount * factor * rate * 1000);
  if (Number.isSafeInteger(normal)) return BigInt(normal);
  const [mantissa, exponentText = "0"] = rate.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  const exponent = Number(exponentText) - fraction.length;
  let numerator = exactPoints(amount) * BigInt(whole! + fraction) * 1000n;
  let denominator = factor === 0.25 ? 4n : factor === 0.5 ? 2n : 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator *= 10n ** BigInt(-exponent);
  return (2n * numerator + denominator) / (2n * denominator);
}

function pickCost(picks: readonly Pick[]): bigint {
  return picks.reduce((total, { source, amount }) => total + milliCost(source, amount), 0n);
}

function pickYieldExact(picks: readonly Pick[]): bigint {
  return picks.reduce((sum, p) => sum + exactPoints(yieldOf(p.source, p.amount)), 0n);
}
function pickYield(picks: readonly Pick[]): number { return safePoints(pickYieldExact(picks)); }

function finiteValue(value: number): number {
  if (!Number.isFinite(value)) throw new InvalidValuationError();
  return value;
}

function roundedValue(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new InvalidValuationError();
  return rounded;
}

/** Cheapest funding mix covering `need`, or null when balances cannot cover it. */
function fund(sources: readonly Source[], need: number): Pick[] | null {
  const candidates: Pick[][] = [];

  // Plain greedy in efficiency order; the last source is rounded up minimally.
  {
    const picks: Pick[] = [];
    let remaining = need;
    for (const source of sources) {
      if (remaining <= 0) break;
      if (source.maxDest <= remaining) {
        picks.push({ source, amount: source.usable });
        remaining -= source.maxDest;
      } else {
        const x = minAmountFor(source, remaining);
        if (x === null) continue;
        picks.push({ source, amount: x });
        remaining = 0;
      }
    }
    if (remaining <= 0) candidates.push(picks);
  }

  // For each source m: cheaper others in full until m alone can finish.
  for (const marginal of sources) {
    const picks: Pick[] = [];
    let remaining = need;
    for (const source of sources) {
      if (source === marginal) continue;
      if (remaining <= 0) break;
      if (marginal.maxDest >= remaining) break;
      picks.push({ source, amount: source.usable });
      remaining -= source.maxDest;
    }
    if (remaining > 0) {
      const x = minAmountFor(marginal, remaining);
      if (x === null) continue;
      picks.push({ source: marginal, amount: x });
      remaining = 0;
    }
    candidates.push(picks);
  }

  let best: Pick[] | null = null;
  let bestKey: [bigint, bigint, string] | null = null;
  for (const picks of candidates) {
    if (pickYieldExact(picks) < exactPoints(need)) continue;
    const key: [bigint, bigint, string] = [
      pickCost(picks),
      picks.reduce((s, p) => s + exactPoints(p.amount), 0n),
      picks.map((p) => p.source.holding.providerId).sort().join(","),
    ];
    if (
      bestKey === null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] &&
        (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
    ) {
      best = picks;
      bestKey = key;
    }
  }
  return best;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pluralUnit(unit: SweetSpotUnit, n: number): string {
  const base = {
    night: "night",
    one_way: "one-way award",
    round_trip: "round-trip award",
    stay: "stay",
    redemption: "redemption",
  } satisfies Record<SweetSpotUnit, string>;
  return n === 1 ? base[unit] : `${base[unit]}s`;
}

function bonusInfo(bonus: TransferBonus): PlanBonus {
  return {
    id: bonus.id,
    multiplierPermille: bonus.multiplierPermille,
    label: describeBonus(bonus),
    source: bonus.source,
    verified: bonus.verifiedAt !== null,
  };
}

function coverageFor(
  programId: ProviderId,
  missing: number,
  holdings: readonly Holding[],
  used: ReadonlyMap<string, number>,
  bestBonuses: ReadonlyMap<string, TransferBonus>,
  edges: ResolvedGraph,
): CoverageHint[] {
  const balances = new Map(holdings.map((h) => [h.providerId, h.points] as const));
  const hints: CoverageHint[] = [];
  for (const edge of edges.get(programId) ?? []) {
    const permille =
      bestBonuses.get(`${edge.fromProviderId}>${edge.toProviderId}`)
        ?.multiplierPermille ?? 1000;
    const inc = edge.incrementSourcePoints ?? DEFAULT_TRANSFER_INCREMENT;
    const min = edge.minimumSourcePoints ?? inc;
    // Invert the shared two-stage floor exactly: bonus first, then base ratio.
    const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
    const baseNeeded = ceil(exactPoints(missing) * 1000n, exactPoints(permille));
    const ratio = edgeRatio(edge);
    const sourceNeeded = ceil(baseNeeded * exactPoints(ratio.den), exactPoints(ratio.num));
    const increment = exactPoints(inc);
    const minimumBlocks = ceil(exactPoints(min), increment);
    const neededBlocks = ceil(sourceNeeded, increment);
    const blocks = minimumBlocks > neededBlocks ? minimumBlocks : neededBlocks;
    const sourcePointsNeeded = safePoints((blocks > 0n ? blocks : 1n) * increment);
    const balanceAvailable = Math.max(
      0,
      (balances.get(edge.fromProviderId) ?? 0) - (used.get(edge.fromProviderId) ?? 0),
    );
    hints.push({
      providerId: edge.fromProviderId,
      sourcePointsNeeded,
      balanceAvailable,
      canCoverNow: balanceAvailable >= sourcePointsNeeded,
    });
  }
  return hints
    .sort(
      (a, b) =>
        Number(b.canCoverNow) - Number(a.canCoverNow) ||
        Number(b.balanceAvailable > 0) - Number(a.balanceAvailable > 0) ||
        a.sourcePointsNeeded - b.sourcePointsNeeded ||
        a.providerId.localeCompare(b.providerId),
    )
    .slice(0, 5);
}

/**
 * Without an explicit quantity: nights default to what balances cover, up to 3
 * (a typical short stay); small fixed-value redemptions scale to the spot's
 * cap; tickets and package stays default to one.
 */
function defaultUnits(spot: SweetSpot, capacity: bigint): number {
  const quotient = capacity / exactPoints(spot.pointsCost);
  const affordable = Number(quotient > BigInt(spot.maxUnits) ? BigInt(spot.maxUnits) : quotient < 1n ? 1n : quotient);
  if (spot.unit === "night") return Math.min(spot.maxUnits, 3, affordable);
  if (spot.unit === "redemption") return Math.min(spot.maxUnits, affordable);
  return 1;
}

function evaluateSpot(
  spot: SweetSpot,
  input: OptimizerInput,
  bestBonuses: ReadonlyMap<string, TransferBonus>,
  edges: ResolvedGraph,
  warnings: readonly TransferEligibilityWarning[],
): RedemptionPlan | null {
  const { holdings, goal } = input;
  const sources = buildSources(spot.programId, holdings, bestBonuses, edges);
  const capacity = sources.reduce((s, x) => s + exactPoints(x.maxDest), 0n);

  if (sources.length === 0 && !goal.targetProgramId) return null;

  const units = goal.quantity ?? defaultUnits(spot, capacity);
  const need = safePoints(exactPoints(spot.pointsCost) * exactPoints(units));

  const picks = fund(sources, need);
  const status: PlanStatus = picks ? "fundable" : "shortfall";

  let chosen: Pick[];
  if (picks) {
    chosen = picks;
  } else {
    // Partial plan: only worth showing when the user is meaningfully close,
    // or explicitly asked about this program.
    if (!goal.targetProgramId && capacity * 4n < exactPoints(need)) return null;
    chosen = sources.map((source) => ({ source, amount: source.usable }));
  }

  const provided = pickYield(chosen);
  const target = findProvider(spot.programId);
  const targetName = target?.displayName ?? spot.programId;
  const currency = target?.pointsCurrency ?? "points";
  const surplus = Math.max(0, provided - need);
  // Value of the full redemption (for a shortfall: what completing it is worth).
  const valueCents = spot.estimatedCentsPerPoint === 0 ? 0 : estimateValueCents(need, spot.estimatedCentsPerPoint);

  const planSources: PlanSource[] = chosen
    .map(({ source, amount }) => ({
      eligibility: source.edge?.eligibility ?? null,
      providerId: source.holding.providerId,
      displayName:
        findProvider(source.holding.providerId)?.displayName ??
        source.holding.providerId,
      pointsUsed: amount,
      destinationPoints: yieldOf(source, amount),
      direct: source.edge === null,
      ratioFrom: source.edge?.ratioFrom ?? null,
      ratioTo: source.edge?.ratioTo ?? null,
      bonus: source.bonus ? bonusInfo(source.bonus) : null,
      daysUntilExpiry: source.holding.daysUntilExpiry,
    }))
    .sort(
      (a, b) =>
        Number(b.direct) - Number(a.direct) ||
        b.pointsUsed - a.pointsUsed ||
        a.providerId.localeCompare(b.providerId),
    );

  const totalSource = checkedPointSum(planSources.map(p => p.pointsUsed));
  const cppByProvider = new Map(
    holdings.map((h) => [h.providerId, h] as const),
  );
  let opportunity = 0;
  let discounted = 0;
  for (const p of planSources) {
    const h = cppByProvider.get(p.providerId)!;
    opportunity += p.pointsUsed * h.centsPerPoint;
    discounted += p.pointsUsed * h.centsPerPoint * urgencyFactor(h.daysUntilExpiry);
  }
  const opportunityCostCents = roundedValue(opportunity);
  roundedValue(discounted);
  const effectiveCpp =
    status === "fundable" && totalSource > 0
      ? roundedValue((valueCents / totalSource) * 1000) / 1000
      : spot.estimatedCentsPerPoint;

  const steps: PlanStep[] = [];
  for (const p of planSources) {
    if (p.direct) {
      steps.push({
        kind: "use",
        text: `Use ${fmt(p.pointsUsed)} ${currency} you already hold in ${targetName}`,
      });
    } else {
      const bonusText = p.bonus ? ` [${p.bonus.label}${p.bonus.verified ? "" : ", unverified"}]` : "";
      steps.push({
        kind: "transfer",
        text: `Transfer ${fmt(p.pointsUsed)} ${p.displayName} -> ${targetName} at ${p.ratioFrom}:${p.ratioTo}${bonusText} = ${fmt(p.destinationPoints)} ${currency}`,
      });
    }
  }
  steps.push({
    kind: "book",
    text:
      status === "fundable"
        ? `Book ${spot.title} x${units} ${pluralUnit(spot.unit, units)} (about ${fmt(need)} ${currency})`
        : `Then book ${spot.title} (about ${fmt(need)} ${currency} per ${spot.unit.replace("_", "-")})`,
  });
  if (surplus > 0 && status === "fundable") {
    steps.push({
      kind: "note",
      text: `${fmt(surplus)} ${currency} would be left over in ${targetName} (transfer blocks round up).`,
    });
  }

  let shortfall: Shortfall | null = null;
  if (status === "shortfall") {
    const missing = need - provided;
    const used = new Map(planSources.map((p) => [p.providerId, p.pointsUsed] as const));
    shortfall = {
      programId: spot.programId,
      pointsNeeded: missing,
      coverage: coverageFor(spot.programId, missing, holdings, used, bestBonuses, edges),
    };
    steps.push({
      kind: "note",
      text: `You are ${fmt(missing)} ${currency} short for one ${spot.unit.replace("_", "-")}.`,
    });
  }

  // Caveats: honesty first, deterministic order.
  const caveats: string[] = [
    "Award availability is NOT verified: search the program's site before transferring anything.",
    "Transfers between programs are irreversible; only transfer once you have confirmed space.",
    "Points prices are typical ranges from an editorial catalog (not live); verify the exact price on the provider's site.",
  ];
  const eligibilityWarnings = warnings.filter(warning => warning.toProviderId === spot.programId);
  caveats.push(...eligibilityWarnings.map(warning => warning.message));
  let confidence: SweetSpotConfidence = spot.confidence;
  const seen = new Set<string>();
  for (const p of planSources) {
    if (p.bonus) {
      if (!p.bonus.verified) {
        confidence = minConfidence(confidence, "medium");
        const note = `The ${p.displayName} bonus is ${p.bonus.source === "user" ? "user-reported" : "not yet verified"}; confirm it on the issuer's page before transferring.`;
        if (!seen.has(note)) {
          seen.add(note);
          caveats.push(note);
        }
      }
    }
    if (!p.direct) {
      const edge = edges.get(spot.programId)?.find(
        (e) => e.fromProviderId === p.providerId,
      );
      if (edge?.notes && !seen.has(edge.notes)) {
        seen.add(edge.notes);
        caveats.push(`${p.displayName} transfer: ${edge.notes}`);
      }
      if (edge && edge.incrementSourcePoints === undefined) {
        const note = `Assumes transfers in blocks of ${fmt(DEFAULT_TRANSFER_INCREMENT)} points; check the issuer's minimum and increment.`;
        if (!seen.has(note)) {
          seen.add(note);
          caveats.push(note);
        }
      }
    }
  }
  for (const c of spot.constraints) caveats.push(c);
  if (spot.confidence === "low") {
    caveats.push("Low-confidence catalog entry: treat as a lead to check, not a recommendation.");
  }
  let urgency: ExpiryUrgency = "none";
  for (const p of planSources) {
    const u = urgencyOf(p.daysUntilExpiry);
    if (URGENCY_RANK[u] > URGENCY_RANK[urgency]) urgency = u;
  }
  if (urgency !== "none") {
    caveats.push(
      "Some points used here are projected to expire soon (inactivity-based); redeeming may or may not reset the clock, so check the program's rules.",
    );
  }
  if (status === "shortfall") {
    caveats.push("This plan is not fully funded by your current balances.");
  }

  return {
    eligibilityWarnings,
    id: spot.id,
    spotId: spot.id,
    programId: spot.programId,
    kind: spot.kind,
    title: spot.title,
    units,
    unit: spot.unit,
    status,
    steps,
    sources: planSources,
    totalSourcePoints: totalSource,
    destinationPointsNeeded: need,
    destinationPointsProvided: provided,
    surplusDestinationPoints: surplus,
    valueCents,
    effectiveCentsPerPoint: effectiveCpp,
    opportunityCostCents,
    netGainCents: status === "fundable" ? valueCents - opportunityCostCents : 0,
    rankScoreCents: status === "fundable" ? roundedValue(valueCents - discounted) : 0,
    shortfall,
    expiryUrgency: urgency,
    confidence,
    caveats,
    availability: null,
  };
}

function matchesGoal(spot: SweetSpot, goal: RedemptionGoal): boolean {
  if (goal.targetProgramId && spot.programId !== goal.targetProgramId) return false;
  if (goal.kind === "any") return true;
  return spot.kind === goal.kind;
}

/** Plans for the goal, best first. Pure and deterministic. */
export function optimizeRedemptions(input: OptimizerInput): OptimizerResult {
  assertValidGoal(input.goal);
  for (const holding of input.holdings) {
    exactPoints(holding.points);
    // Zero valuation remains supported by the existing optimizer policy.
    if (!Number.isFinite(holding.centsPerPoint) || holding.centsPerPoint < 0) throw new InvalidValuationError();
  }
  const holdings = input.holdings.filter((h) => h.points > 0);
  const notes: string[] = [];
  if (holdings.length === 0) {
    notes.push("No balances to optimize: link accounts and record balances first.");
  }
  const bestBonuses = indexBestBonuses(input.bonuses, input.now);
  const spots = input.sweetSpots ?? SWEET_SPOTS;
  const graph = resolveGraph(holdings, input.now);
  const eligibilityWarnings = graph.warnings.filter(warning => !input.goal.targetProgramId || warning.toProviderId === input.goal.targetProgramId);
  notes.push(...eligibilityWarnings.map(warning => warning.message));

  const plans: RedemptionPlan[] = [];
  for (const spot of spots) {
    if (!matchesGoal(spot, input.goal)) continue;
    if (exactPoints(spot.pointsCost) === 0n || exactPoints(spot.maxUnits) === 0n) throw new InvalidRedemptionGoalError("Sweet spot cost and units must be positive safe integers");
    if (!Number.isFinite(spot.estimatedCentsPerPoint) || spot.estimatedCentsPerPoint < 0) throw new InvalidValuationError();
    const plan = evaluateSpot(spot, { ...input, holdings }, bestBonuses, graph.edges, eligibilityWarnings);
    if (!plan) continue;
    const cpp = plan.status === "fundable" ? plan.effectiveCentsPerPoint : spot.estimatedCentsPerPoint;
    if (input.goal.minValueCpp !== undefined && cpp < input.goal.minValueCpp) continue;
    plans.push(plan);
  }

  plans.sort((a, b) => {
    if (a.status !== b.status) return a.status === "fundable" ? -1 : 1;
    if (a.status === "fundable") {
      return (
        b.rankScoreCents - a.rankScoreCents ||
        b.effectiveCentsPerPoint - a.effectiveCentsPerPoint ||
        a.id.localeCompare(b.id)
      );
    }
    return (
      b.destinationPointsProvided / b.destinationPointsNeeded -
        a.destinationPointsProvided / a.destinationPointsNeeded ||
      a.id.localeCompare(b.id)
    );
  });
  const limited = plans.slice(0, input.maxPlans ?? 10);

  const usedProviders = new Set<string>();
  for (const plan of limited) {
    for (const s of plan.sources) usedProviders.add(s.providerId);
  }
  const expiringHoldings: ExpiringHolding[] = holdings
    .filter((h) => h.daysUntilExpiry !== null && h.daysUntilExpiry <= SOON_DAYS)
    .map((h) => ({
      providerId: h.providerId,
      points: h.points,
      daysUntilExpiry: h.daysUntilExpiry as number,
      usedByPlan: usedProviders.has(h.providerId),
    }))
    .sort(
      (a, b) =>
        a.daysUntilExpiry - b.daysUntilExpiry ||
        a.providerId.localeCompare(b.providerId),
    );
  if (holdings.length > 0 && limited.length === 0) {
    notes.push(
      "No catalog redemption matched your balances and goal. Try a different goal or link more programs.",
    );
  }
  return { plans: limited, expiringHoldings, notes, eligibilityWarnings };
}
