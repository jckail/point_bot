import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
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

import type { LoyaltyAccountId, TripGoalId, UserId } from "../../domain/shared/ids";
export interface UpdateTripGoalInput {
  readonly userId: UserId;
  readonly goalId: TripGoalId;
  readonly title?: string;
  readonly targetPoints?: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly LoyaltyAccountId[];
  readonly status?: TripGoalStatus;
  readonly notes?: string | null;
}

async function requireOwnedGoal(
  goals: TripGoalRepository,
  userId: UserId,
  goalId: TripGoalId,
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
    private readonly eventing: Eventing = noopEventing,
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

    const changed = (
      [
        "title",
        "targetPoints",
        "targetDate",
        "accountIds",
        "status",
        "notes",
      ] as const
    ).filter((field) => input[field] !== undefined);
    await this.eventing.unitOfWork.run(async () => {
      await this.goals.update(updated);
      await this.eventing.publisher.publish([
        createDomainEvent("goal.updated", {
          userId: input.userId,
          aggregateId: goal.id,
          occurredAt: updated.updatedAt,
          payload: { changed },
        }),
      ]);
    });
    return toReadModel(updated, this.balances);
  }
}

export class DeleteTripGoal {
  constructor(
    private readonly goals: TripGoalRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(userId: UserId, goalId: TripGoalId): Promise<void> {
    await requireOwnedGoal(this.goals, userId, goalId);
    await this.eventing.unitOfWork.run(async () => {
      await this.goals.delete(goalId);
      await this.eventing.publisher.publish([
        createDomainEvent("goal.deleted", {
          userId,
          aggregateId: goalId,
          occurredAt: this.clock.now(),
          payload: {},
        }),
      ]);
    });
  }
}
