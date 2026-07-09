import type {
  BalanceSnapshotRepository,
  TripGoalRepository,
} from "../../domain/loyalty/repositories";
import {
  computeGoalProgress,
  type TripGoal,
} from "../../domain/loyalty/trip-goal";
import type { TripGoalReadModel } from "./create-trip-goal";

function toReadModelSync(
  goal: TripGoal,
  balancesByAccountId: ReadonlyMap<string, number>,
): TripGoalReadModel {
  const progress = computeGoalProgress(goal, balancesByAccountId);
  return {
    id: goal.id,
    title: goal.title,
    targetPoints: goal.targetPoints,
    targetDate: goal.targetDate,
    accountIds: goal.accountIds,
    status: goal.status,
    notes: goal.notes,
    currentPoints: progress.currentPoints,
    remainingPoints: progress.remainingPoints,
    percentComplete: progress.percentComplete,
    achieved: progress.achieved,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export class ListTripGoals {
  constructor(
    private readonly goals: TripGoalRepository,
    private readonly balances: BalanceSnapshotRepository,
  ) {}

  async execute(userId: string): Promise<TripGoalReadModel[]> {
    const goals = await this.goals.findByUserId(userId);
    const accountIds = [...new Set(goals.flatMap((goal) => goal.accountIds))];
    const latest = await this.balances.findLatestByAccountIds(accountIds);
    const balancesByAccountId = new Map<string, number>();
    for (const [accountId, snapshot] of latest) {
      balancesByAccountId.set(accountId, snapshot.points);
    }

    return goals
      .map((goal) => toReadModelSync(goal, balancesByAccountId))
      .sort((a, b) => {
        // Active first, then by soonest target date, then newest.
        if (a.status !== b.status) {
          if (a.status === "active") return -1;
          if (b.status === "active") return 1;
        }
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
  }
}
