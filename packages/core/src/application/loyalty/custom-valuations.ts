import {
  normalizeCentsPerPoint,
  type CustomValuation,
  type CustomValuationRepository,
} from "../../domain/loyalty/custom-valuation";
import { getProviderOrThrow } from "../../domain/loyalty/provider";
import type { Clock } from "../ports";
import { systemClock } from "../ports";

import type { UserId } from "../../domain/shared/ids";
export class ListCustomValuations {
  constructor(private readonly valuations: CustomValuationRepository) {}

  execute(userId: UserId): Promise<CustomValuation[]> {
    return this.valuations.listForUser(userId);
  }
}

/**
 * Sets (or replaces) a user's cents-per-point override for a provider. Rejects
 * unknown providers and out-of-range values before persisting.
 */
export class SetCustomValuation {
  constructor(
    private readonly valuations: CustomValuationRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(input: {
    readonly userId: UserId;
    readonly providerId: string;
    readonly centsPerPoint: number;
  }): Promise<CustomValuation> {
    getProviderOrThrow(input.providerId);
    const centsPerPoint = normalizeCentsPerPoint(input.centsPerPoint);

    const valuation: CustomValuation = {
      userId: input.userId,
      providerId: input.providerId,
      centsPerPoint,
      updatedAt: this.clock.now(),
    };
    await this.valuations.upsert(valuation);
    return valuation;
  }
}

export class DeleteCustomValuation {
  constructor(private readonly valuations: CustomValuationRepository) {}

  execute(userId: UserId, providerId: string): Promise<void> {
    return this.valuations.delete(userId, providerId);
  }
}
