import { InvalidBalanceError, InvalidCaptureTimeError } from "../errors";

/** How a balance value entered the system. */
export type BalanceSource = "sync" | "manual";

/**
 * A point-in-time reading of a loyalty account's balance. Snapshots are
 * append-only, which gives every surface a balance history for free.
 */
export interface BalanceSnapshot {
  readonly id: string;
  readonly loyaltyAccountId: string;
  readonly points: number;
  readonly source: BalanceSource;
  readonly capturedAt: Date;
}

export interface NewBalanceSnapshot {
  readonly loyaltyAccountId: string;
  readonly points: number;
  readonly source: BalanceSource;
  readonly id?: string;
  readonly capturedAt?: Date;
}

export function createBalanceSnapshot(
  input: NewBalanceSnapshot,
): BalanceSnapshot {
  if (!Number.isInteger(input.points) || input.points < 0) {
    throw new InvalidBalanceError();
  }
  if (input.capturedAt && Number.isNaN(input.capturedAt.getTime())) {
    throw new InvalidCaptureTimeError("not a valid timestamp");
  }

  return {
    id: input.id ?? crypto.randomUUID(),
    loyaltyAccountId: input.loyaltyAccountId,
    points: input.points,
    source: input.source,
    capturedAt: input.capturedAt ?? new Date(),
  };
}
