import {
  LoyaltyAccountNotFoundError,
  TripGoalNotFoundError,
} from "../../domain/errors";
import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
  TripGoalRepository,
} from "../../domain/loyalty/repositories";
import {
  applyTripGoalChanges,
  computeGoalProgress,
  type TripGoal,
  type TripGoalStatus,
} from "../../domain/loyalty/trip-goal";
import type { Clock } from "../ports";
import { systemClock } from "../ports";
import type { TripGoalReadModel } from "./create-trip-goal";

export interface UpdateTripGoalInput {
  readonly userId: string;
  readonly goalId: string;
  readonly title?: string;
  readonly targetPoints?: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly string[];
  readonly status?: TripGoalStatus;
  readonly notes?: string | null;
}

async function requireOwnedGoal(
  goals: TripGoalRepository,
  userId: string,
  goalId: string,
): Promise<TripGoal> {
  const goal = await goals.findById(goalId);
  if (!goal || goal.userId !== userId) {
    throw new TripGoalNotFoundError(goalId);
  }
  return goal;
}

async function toReadModel(
  goal: TripGoal,
  balances: BalanceSnapshotRepository,
): Promise<TripGoalReadModel> {
  const latest = await balances.findLatestByAccountIds(goal.accountIds);
  const balancesByAccountId = new Map<string, number>();
  for (const [accountId, snapshot] of latest) {
    balancesByAccountId.set(accountId, snapshot.points);
  }
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

export class UpdateTripGoal {
  constructor(
    private readonly goals: TripGoalRepository,
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: UpdateTripGoalInput): Promise<TripGoalReadModel> {
    const goal = await requireOwnedGoal(
      this.goals,
      input.userId,
      input.goalId,
    );

    if (input.accountIds) {
      for (const accountId of input.accountIds) {
        const account = await this.accounts.findById(accountId);
        if (!account || account.userId !== input.userId) {
          throw new LoyaltyAccountNotFoundError(accountId);
        }
      }
    }

    const updated = applyTripGoalChanges(goal, {
      title: input.title,
      targetPoints: input.targetPoints,
      targetDate: input.targetDate,
      accountIds: input.accountIds,
      status: input.status,
      notes: input.notes,
      now: this.clock.now(),
    });

    await this.goals.update(updated);
    return toReadModel(updated, this.balances);
  }
}

export class DeleteTripGoal {
  constructor(private readonly goals: TripGoalRepository) {}

  async execute(userId: string, goalId: string): Promise<void> {
    await requireOwnedGoal(this.goals, userId, goalId);
    await this.goals.delete(goalId);
  }
}
