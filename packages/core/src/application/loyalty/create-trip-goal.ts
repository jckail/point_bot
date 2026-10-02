import { createDomainEvent } from "../../domain/events";
import { noopEventing, type Eventing } from "../events/ports";
import type {
  BalanceSnapshotRepository,
  LoyaltyAccountRepository,
  TripGoalRepository,
} from "../../domain/loyalty/repositories";
import {
  computeGoalProgress,
  createTripGoal,
  type TripGoal,
} from "../../domain/loyalty/trip-goal";
import { lockGoalAccountReferences } from "./goal-account-references";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

import type { LoyaltyAccountId, TripGoalId, UserId } from "../../domain/shared/ids";
export interface CreateTripGoalInput {
  readonly userId: UserId;
  readonly title: string;
  readonly targetPoints: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly LoyaltyAccountId[];
  readonly notes?: string | null;
}

export interface TripGoalReadModel {
  readonly id: TripGoalId;
  readonly title: string;
  readonly targetPoints: number;
  readonly targetDate: string | null;
  readonly accountIds: readonly LoyaltyAccountId[];
  readonly status: TripGoal["status"];
  readonly notes: string | null;
  readonly currentPoints: number;
  readonly remainingPoints: number;
  readonly percentComplete: number;
  readonly achieved: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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

export class CreateTripGoal {
  constructor(
    private readonly goals: TripGoalRepository,
    private readonly accounts: LoyaltyAccountRepository,
    private readonly balances: BalanceSnapshotRepository,
    private readonly clock: Clock = systemClock,
    private readonly eventing: Eventing = noopEventing,
  ) {}

  async execute(input: CreateTripGoalInput): Promise<TripGoalReadModel> {
    const accountIds = input.accountIds ?? [];

    const goal = createTripGoal({
      userId: input.userId,
      title: input.title,
      targetPoints: input.targetPoints,
      targetDate: input.targetDate,
      accountIds,
      notes: input.notes,
      now: this.clock.now(),
    });

    await this.eventing.unitOfWork.run(async () => {
      await lockGoalAccountReferences(this.accounts, input.userId, goal.accountIds, this.eventing);
      await this.goals.insert(goal);
      await this.eventing.publisher.publish([
        createDomainEvent("goal.created", {
          userId: goal.userId,
          aggregateId: goal.id,
          occurredAt: goal.createdAt,
          payload: { targetPoints: goal.targetPoints },
        }),
      ]);
    });
    return toReadModel(goal, this.balances);
  }
}
