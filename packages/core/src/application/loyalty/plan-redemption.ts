import type {
  AwardSearchQuery,
  AwardSearchResult,
} from "../../domain/loyalty/award-availability";
import {
  assertValidGoal,
  optimizeRedemptions,
  type Holding,
  type OptimizerResult,
  type RedemptionGoal,
  type RedemptionPlan,
} from "../../domain/loyalty/optimizer";
import type { SweetSpot } from "../../domain/loyalty/catalog/sweet-spots";
import { isBonusActive } from "../../domain/loyalty/transfer-bonus";
import type { AwardAvailabilitySource, Clock } from "../ports";
import { systemClock } from "../ports";
import type { ListLoyaltyAccounts } from "./list-loyalty-accounts";
import type { LoyaltyAccountReadModel } from "./read-models";
import type { ListActiveTransferBonuses } from "./transfer-bonuses";

import type { UserId } from "../../domain/shared/ids";
export interface PlanRedemptionInput {
  readonly userId: UserId;
  readonly goal?: Partial<RedemptionGoal>;
  /** When set (flight goals), real award space is searched and attached. */
  readonly award?: AwardSearchQuery;
  readonly maxPlans?: number;
}

export interface AvailabilityReport {
  readonly status: AwardSearchResult["status"];
  readonly checkedAt: string;
  readonly message: string | null;
}

export interface PlanRedemptionResult extends OptimizerResult {
  readonly goal: RedemptionGoal;
  readonly generatedAt: string;
  /** Bonuses that were active (and therefore considered) for this run. */
  readonly activeBonusCount: number;
  /** Null unless an award search was requested. */
  readonly availability: AvailabilityReport | null;
}

/** Account read models -> optimizer holdings (custom valuation wins). */
export function toHoldings(
  accounts: readonly LoyaltyAccountReadModel[],
): Holding[] {
  return accounts.map((account) => ({
    providerId: account.provider.id,
    cardProductId: account.cardProductId ?? null,
    points: account.latestBalance?.points ?? 0,
    centsPerPoint:
      account.customCentsPerPoint ?? account.provider.estimatedCentsPerPoint,
    daysUntilExpiry: account.daysUntilExpiry,
  }));
}

/**
 * "Find deals and optimally use my points": builds ranked redemption plans
 * from the user's balances, active transfer bonuses and the sweet-spot
 * catalog (see domain/loyalty/optimizer.ts). Real award availability is
 * attached only when an award source is configured and returns data.
 */
export class PlanRedemption {
  constructor(
    private readonly listAccounts: ListLoyaltyAccounts,
    private readonly bonuses: ListActiveTransferBonuses,
    private readonly availability: AwardAvailabilitySource,
    private readonly clock: Clock = systemClock,
    private readonly sweetSpots?: readonly SweetSpot[],
  ) {}

  async execute(input: PlanRedemptionInput): Promise<PlanRedemptionResult> {
    const goal: RedemptionGoal = { kind: "any", ...input.goal };
    assertValidGoal(goal);
    // External search can outlast a bonus or a card-selection change. Read the
    // portfolio and bonus window after it finishes, then evaluate once.
    const found = input.award && goal.kind !== "hotel"
      ? await this.availability.searchAwards(input.award) : null;
    const [accounts, listedBonuses] = await Promise.all([
      this.listAccounts.execute(input.userId),
      this.bonuses.execute(input.userId),
    ]);
    const now = this.clock.now();
    const bonuses = listedBonuses.filter(bonus => isBonusActive(bonus, now));
    const result = optimizeRedemptions({
      holdings: toHoldings(accounts),
      goal,
      bonuses,
      now,
      sweetSpots: this.sweetSpots,
      maxPlans: input.maxPlans,
    });

    const report: AvailabilityReport | null = found ? {
      status: found.status,
      checkedAt: found.checkedAt.toISOString(),
      message: found.message,
    } : null;
    const plans = found?.status === "ok"
      ? result.plans.map(plan => annotate(plan, found)) : result.plans;

    return {
      ...result,
      plans,
      goal,
      generatedAt: now.toISOString(),
      activeBonusCount: bonuses.length,
      availability: report,
    };
  }
}

function annotate(
  plan: RedemptionPlan,
  found: AwardSearchResult,
): RedemptionPlan {
  if (plan.kind !== "flight") return plan;
  const options = found.options
    .filter((o) => o.programId === plan.programId)
    .slice(0, 5);
  if (options.length === 0) return plan;
  return {
    ...plan,
    availability: { checkedAt: found.checkedAt.toISOString(), options },
    caveats: [
      `Award space was reported by the configured search source at ${found.checkedAt.toISOString()}; seats can disappear, so re-check before transferring.`,
      ...plan.caveats.filter((c) => !c.startsWith("Award availability is NOT verified")),
    ],
  };
}

export interface ListBestRedemptionsInput {
  readonly userId: UserId;
  readonly limit?: number;
}

/**
 * Short, diversified list for dashboards and chat: the best plans overall with
 * at most two per program so one program cannot crowd out the rest.
 */
export class ListBestRedemptions {
  constructor(private readonly plan: PlanRedemption) {}

  async execute(input: ListBestRedemptionsInput): Promise<PlanRedemptionResult> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const result = await this.plan.execute({
      userId: input.userId,
      goal: { kind: "any" },
      maxPlans: 50,
    });
    const perProgram = new Map<string, number>();
    const plans: RedemptionPlan[] = [];
    for (const plan of result.plans) {
      const count = perProgram.get(plan.programId) ?? 0;
      if (count >= 2) continue;
      perProgram.set(plan.programId, count + 1);
      plans.push(plan);
      if (plans.length >= limit) break;
    }
    return { ...result, plans };
  }
}
