import { InvalidValuationError } from "../errors";

/**
 * A per-user override of a program's editorial cents-per-point valuation.
 * When present, portfolio value for that provider is computed from this rate
 * instead of the catalog default.
 */
export interface CustomValuation {
  readonly userId: string;
  readonly providerId: string;
  /** Override redemption value of one point, in US cents (e.g. 1.8). */
  readonly centsPerPoint: number;
  readonly updatedAt: Date;
}

/** Upper bound guards against fat-finger inputs; 100¢/pt is already extreme. */
export const MAX_CENTS_PER_POINT = 100;

export function assertValidCentsPerPoint(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_CENTS_PER_POINT) {
    throw new InvalidValuationError();
  }
}

export interface CustomValuationRepository {
  listForUser(userId: string): Promise<CustomValuation[]>;
  upsert(valuation: CustomValuation): Promise<void>;
  delete(userId: string, providerId: string): Promise<void>;
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
