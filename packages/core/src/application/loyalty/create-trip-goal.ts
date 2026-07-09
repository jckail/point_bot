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
import { LoyaltyAccountNotFoundError } from "../../domain/errors";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

export interface CreateTripGoalInput {
  readonly userId: string;
  readonly title: string;
  readonly targetPoints: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly string[];
  readonly notes?: string | null;
}

export interface TripGoalReadModel {
  readonly id: string;
  readonly title: string;
  readonly targetPoints: number;
  readonly targetDate: string | null;
  readonly accountIds: readonly string[];
  readonly status: TripGoal["status"];
  readonly notes: string | null;
  readonly currentPoints: number;
  readonly remainingPoints: number;
  readonly percentComplete: number;
  readonly achieved: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

async function assertOwnedAccounts(
  accounts: LoyaltyAccountRepository,
  userId: string,
  accountIds: readonly string[],
): Promise<void> {
  for (const accountId of accountIds) {
    const account = await accounts.findById(accountId);
    if (!account || account.userId !== userId) {
      throw new LoyaltyAccountNotFoundError(accountId);
    }
  }
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
  ) {}

  async execute(input: CreateTripGoalInput): Promise<TripGoalReadModel> {
    const accountIds = input.accountIds ?? [];
    await assertOwnedAccounts(this.accounts, input.userId, accountIds);

    const goal = createTripGoal({
      userId: input.userId,
      title: input.title,
      targetPoints: input.targetPoints,
      targetDate: input.targetDate,
      accountIds,
      notes: input.notes,
      now: this.clock.now(),
    });

    await this.goals.insert(goal);
    return toReadModel(goal, this.balances);
  }
}
