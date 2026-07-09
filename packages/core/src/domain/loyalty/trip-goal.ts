import { InvalidGoalTitleError, InvalidGoalTargetError } from "../errors";

/**
 * A savings target toward a trip or redemption ("80k Hyatt for Kyoto").
 * Progress is computed against the latest balances of the linked accounts.
 */
export type TripGoalStatus = "active" | "achieved" | "archived";

export interface TripGoal {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly targetPoints: number;
  /** Optional ISO date (YYYY-MM-DD) the user hopes to redeem by. */
  readonly targetDate: string | null;
  /** Loyalty account ids whose balances count toward this goal. */
  readonly accountIds: readonly string[];
  readonly status: TripGoalStatus;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewTripGoal {
  readonly userId: string;
  readonly title: string;
  readonly targetPoints: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly string[];
  readonly notes?: string | null;
  readonly id?: string;
  readonly now?: Date;
}

export interface TripGoalChanges {
  readonly title?: string;
  readonly targetPoints?: number;
  readonly targetDate?: string | null;
  readonly accountIds?: readonly string[];
  readonly status?: TripGoalStatus;
  readonly notes?: string | null;
  readonly now?: Date;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new InvalidGoalTitleError();
  }
  return trimmed;
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes == null) return null;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 2000) {
    throw new InvalidGoalTitleError("Goal notes must be at most 2000 characters");
  }
  return trimmed;
}

function assertTargetPoints(points: number): void {
  if (!Number.isInteger(points) || points <= 0) {
    throw new InvalidGoalTargetError();
  }
}

export function createTripGoal(input: NewTripGoal): TripGoal {
  assertTargetPoints(input.targetPoints);
  const now = input.now ?? new Date();

  return {
    id: input.id ?? crypto.randomUUID(),
    userId: input.userId,
    title: normalizeTitle(input.title),
    targetPoints: input.targetPoints,
    targetDate: input.targetDate ?? null,
    accountIds: input.accountIds ?? [],
    status: "active",
    notes: normalizeNotes(input.notes),
    createdAt: now,
    updatedAt: now,
  };
}

export function applyTripGoalChanges(
  goal: TripGoal,
  changes: TripGoalChanges,
): TripGoal {
  const targetPoints = changes.targetPoints ?? goal.targetPoints;
  assertTargetPoints(targetPoints);

  return {
    ...goal,
    title:
      changes.title !== undefined ? normalizeTitle(changes.title) : goal.title,
    targetPoints,
    targetDate:
      changes.targetDate !== undefined ? changes.targetDate : goal.targetDate,
    accountIds: changes.accountIds ?? goal.accountIds,
    status: changes.status ?? goal.status,
    notes:
      changes.notes !== undefined
        ? normalizeNotes(changes.notes)
        : goal.notes,
    updatedAt: changes.now ?? new Date(),
  };
}

export interface TripGoalProgress {
  readonly currentPoints: number;
  readonly remainingPoints: number;
  readonly percentComplete: number;
  readonly achieved: boolean;
}

/** Sum linked account balances and compare to the goal target. */
export function computeGoalProgress(
  goal: TripGoal,
  balancesByAccountId: ReadonlyMap<string, number>,
): TripGoalProgress {
  const current = goal.accountIds.reduce(
    (sum, accountId) => sum + (balancesByAccountId.get(accountId) ?? 0),
    0,
  );
  const remaining = Math.max(0, goal.targetPoints - current);
  const percentComplete =
    goal.targetPoints === 0
      ? 0
      : Math.min(100, Math.round((current / goal.targetPoints) * 1000) / 10);

  return {
    currentPoints: current,
    remainingPoints: remaining,
    percentComplete,
    achieved: current >= goal.targetPoints,
  };
}
