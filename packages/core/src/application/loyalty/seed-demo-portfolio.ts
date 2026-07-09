import { DemoPortfolioNotEmptyError } from "../../domain/errors";
import {
  applyLoyaltyAccountChanges,
} from "../../domain/loyalty/loyalty-account";
import type { LoyaltyAccountRepository } from "../../domain/loyalty/repositories";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { CreateTripGoal } from "./create-trip-goal";
import type { LinkLoyaltyAccount } from "./link-loyalty-account";
import type { RecordManualBalance } from "./record-manual-balance";

export interface DemoSeedAccount {
  readonly providerId: string;
  readonly membershipNumber: string;
  readonly points: number;
  readonly tags?: readonly string[];
  readonly notes?: string;
  readonly pinned?: boolean;
}

export const DEMO_PORTFOLIO: readonly DemoSeedAccount[] = [
  {
    providerId: "chase-ultimate-rewards",
    membershipNumber: "DEMO-UR-1001",
    points: 128_400,
    tags: ["transferable", "demo"],
    notes: "Primary transferable currency",
    pinned: true,
  },
  {
    providerId: "united",
    membershipNumber: "DEMO-UA-4821",
    points: 54_200,
    tags: ["airline", "demo"],
  },
  {
    providerId: "hilton",
    membershipNumber: "DEMO-HH-902",
    points: 86_000,
    tags: ["hotel", "demo"],
  },
  {
    providerId: "hyatt",
    membershipNumber: "DEMO-HY-331",
    points: 42_500,
    tags: ["hotel", "demo", "goal"],
    notes: "Working toward a Kyoto stay",
  },
  {
    providerId: "amtrak",
    membershipNumber: "DEMO-AMT-77",
    points: 12_800,
    tags: ["rail", "demo"],
  },
];

export interface SeedDemoPortfolioResult {
  readonly accountIds: readonly string[];
  readonly goalId: string | null;
}

/**
 * Seeds a realistic sample portfolio for empty accounts — used by the
 * dashboard "Try sample data" CTA. Refuses to run if the user already has
 * linked programs so we never clobber real data.
 */
export class SeedDemoPortfolio {
  constructor(
    private readonly accounts: LoyaltyAccountRepository,
    private readonly link: LinkLoyaltyAccount,
    private readonly recordBalance: RecordManualBalance,
    private readonly createGoal?: CreateTripGoal,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(userId: string): Promise<SeedDemoPortfolioResult> {
    const existing = await this.accounts.findByUserId(userId);
    if (existing.length > 0) {
      throw new DemoPortfolioNotEmptyError();
    }

    const now = this.clock.now();
    const accountIds: string[] = [];
    let hyattId: string | null = null;

    for (const seed of DEMO_PORTFOLIO) {
      const linked = await this.link.execute({
        userId,
        providerId: seed.providerId,
        membershipNumber: seed.membershipNumber,
      });
      accountIds.push(linked.accountId);

      const capturedAt = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      await this.recordBalance.execute({
        userId,
        accountId: linked.accountId,
        points: Math.round(seed.points * 0.85),
        capturedAt,
      });
      await this.recordBalance.execute({
        userId,
        accountId: linked.accountId,
        points: seed.points,
        capturedAt: now,
      });

      const account = await this.accounts.findById(linked.accountId);
      if (account) {
        await this.accounts.update(
          applyLoyaltyAccountChanges(
            account,
            {
              notes: seed.notes ?? null,
              tags: seed.tags ?? [],
              pinnedAt: seed.pinned ? now : null,
            },
            now,
          ),
        );
      }

      if (seed.providerId === "hyatt") {
        hyattId = linked.accountId;
      }
    }

    let goalId: string | null = null;
    if (this.createGoal && hyattId) {
      const goal = await this.createGoal.execute({
        userId,
        title: "Kyoto Hyatt stay",
        targetPoints: 70_000,
        targetDate: "2026-12-15",
        accountIds: [hyattId],
        notes: "Sample trip goal from the demo portfolio",
      });
      goalId = goal.id;
    }

    return { accountIds, goalId };
  }
}
