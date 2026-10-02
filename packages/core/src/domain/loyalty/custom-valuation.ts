import { InvalidValuationError } from "../errors";

import type { UserId } from "../shared/ids";
/**
 * A per-user override of a program's editorial cents-per-point valuation.
 * When present, portfolio value for that provider is computed from this rate
 * instead of the catalog default.
 */
export interface CustomValuation {
  readonly userId: UserId;
  readonly providerId: string;
  /** Override redemption value of one point, in US cents (e.g. 1.8). */
  readonly centsPerPoint: number;
  readonly updatedAt: Date;
}

/** Upper bound guards against fat-finger inputs; 100¢/pt is already extreme. */
export const MAX_CENTS_PER_POINT = 100;

/** Normalize once so immediate responses and milli-cents storage agree. */
export function normalizeCentsPerPoint(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_CENTS_PER_POINT) {
    throw new InvalidValuationError();
  }
  const milli = Math.round(value * 1000);
  if (milli < 1) throw new InvalidValuationError();
  return milli / 1000;
}

export function assertValidCentsPerPoint(value: number): void {
  normalizeCentsPerPoint(value);
}

export interface CustomValuationRepository {
  listForUser(userId: UserId): Promise<CustomValuation[]>;
  upsert(valuation: CustomValuation): Promise<void>;
  delete(userId: UserId, providerId: string): Promise<void>;
}

/**
 * Builds a providerId → centsPerPoint lookup from a user's overrides, for the
 * read-model mapper to apply.
 */
export function toValuationOverrides(
  valuations: readonly CustomValuation[],
): Map<string, number> {
  return new Map(valuations.map((v) => [v.providerId, v.centsPerPoint]));
}
